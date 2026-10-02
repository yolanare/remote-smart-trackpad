# What a focused web field really holds, read through IAccessible2 (Chromium, Electron apps, Firefox).
# UI Automation reads a field's text including text the page only draws: CSS generated content (::before/::after
# placeholders) and non-editable children (contenteditable=false placeholders). IAccessible2 tells the user's
# editable text apart (see Inspect), so a field without editable text only shows a placeholder, if anything.
# tests/fixtures/placeholders.html lists the cases; scripts/placeholder-check.mjs checks them in each browser.
Add-Type -ReferencedAssemblies Accessibility -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Accessibility;

public sealed class FieldContent {
    // An <input> or <textarea>: its value is the content, whatever UI Automation reads as text.
    public bool Native;
    public string Value = "";
    // Visible characters in editable text, and anything else editable that is not text (images, mentions).
    public bool EditableText, EditableObject;
    // Visible characters the user cannot edit: generated content, contenteditable=false decorations. Not needed to
    // decide (no editable content already means a placeholder), it explains verdicts in the placeholder check.
    public bool OtherText;
    // No accessible children at all: empty, or Firefox's role=textbox fields, which hide their text nodes.
    public bool Leafless = true;
    // A page's element (IAccessible2 names its tag), not the browser's own interface (Chrome's address bar), whose
    // text is always the user's.
    public bool Dom;
    // The field holds one line only (IAccessible2's single-line state; text-mirror.ps1 trusts it for <input> only).
    public bool SingleLine;

    [ComImport, Guid("6d5140c1-7436-11ce-8034-00aa006009fa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IServiceProvider { [PreserveSig] int QueryService(ref Guid service, ref Guid riid, out IntPtr result); }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct GuiThreadInfo { public int Size, Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret; public Rect CaretRect; }
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr window, int id, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object result);
    [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible parent, int start, int count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] object[] children, out int obtained);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int ReadInt(IntPtr self, out int value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int ReadString(IntPtr self, [MarshalAs(UnmanagedType.BStr)] out string value);
    static Guid AccessibleId = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    static Guid Accessible2Id = new Guid("E89F726E-C4F4-4c19-BB19-B647D7FA8478");
    // IAccessible2 vtable slots: IUnknown (3) + IDispatch (4) + IAccessible (21), then get_states and get_attributes.
    const int StatesSlot = 35, AttributesSlot = 45, EditableState = 0x8, SingleLineState = 0x2000, FocusedState = 0x4, NodeLimit = 4000;

    /// <summary>The focused field's content, or null when the focused object or IAccessible2 is unavailable.</summary>
    public static FieldContent Focused(string expectedName) {
        IntPtr window = GetForegroundWindow();
        var info = new GuiThreadInfo { Size = Marshal.SizeOf(typeof(GuiThreadInfo)) };
        if (window == IntPtr.Zero || !GetGUIThreadInfo(GetWindowThreadProcessId(window, IntPtr.Zero), ref info) || info.Focus == IntPtr.Zero) return null;
        object root; Guid id = AccessibleId;
        if (AccessibleObjectFromWindow(info.Focus, -4, ref id, out root) != 0) return null;
        // accFocus leads from the window's document down to the focused object; it answers itself (or nothing) there.
        IAccessible focused = root as IAccessible;
        for (int depth = 0; focused != null && depth < 16; depth++) {
            IAccessible next = null;
            try { next = focused.accFocus as IAccessible; } catch {}
            if (next == null || Same(next, focused)) break;
            focused = next;
        }
        if (focused == null || (State(focused) & FocusedState) == 0) return null;
        // Same object UI Automation reports as focused: both expose the accessible name.
        string name = null;
        try { name = focused.get_accName(0); } catch {}
        if ((name ?? "") != (expectedName ?? "")) return null;
        string attributes = Attributes(focused);
        if (attributes == null) return null;
        var content = new FieldContent();
        content.SingleLine = (Accessible2State(focused) & SingleLineState) != 0;
        content.Native = attributes.Contains("tag:input;") || attributes.Contains("tag:textarea;");
        content.Dom = attributes.Contains("tag:");
        if (!content.Dom) return content;
        if (content.Native) {
            try { content.Value = focused.get_accValue(0) ?? ""; } catch {}
            return content;
        }
        int budget = NodeLimit;
        content.Inspect(focused, true, ref budget);
        return content;
    }

    // Depth first over the field's descendants, stopping at the first editable visible character: from then on the
    // field holds real content and nothing else changes the verdict. A leaf is the user's content when it is editable
    // itself (Chromium marks its text nodes) or is a DOM text node inside an editable element (Firefox marks only
    // elements, and exposes generated content as static text instead).
    void Inspect(IAccessible parent, bool parentEditable, ref int budget) {
        int count = 0;
        try { count = parent.accChildCount; } catch {}
        // One child at a time: a long document has thousands, and the first editable text usually ends the walk.
        var slot = new object[1];
        for (int index = 0; index < count && !EditableText && --budget > 0; index++) {
            int obtained;
            if (AccessibleChildren(parent, index, 1, slot, out obtained) != 0 || obtained != 1) return;
            var child = slot[0] as IAccessible;
            if (child == null) continue;
            Leafless = false;
            bool editable = (Accessible2State(child) & EditableState) != 0;
            int childCount = 0;
            try { childCount = child.accChildCount; } catch {}
            if (childCount > 0) { Inspect(child, editable, ref budget); continue; }
            string text = null;
            try { text = child.get_accName(0); } catch {}
            int role = Role(child);
            bool content = editable || (parentEditable && role == TextRole);
            if (HasVisibleCharacter(text)) {
                if (content) EditableText = true; else OtherText = true;
            } else if (editable && role != StaticTextRole && role != TextRole && role != WhitespaceRole) EditableObject = true;
        }
    }

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr window, int index);
    /// <summary>A classic Windows edit box (Edit, RichEdit) without the multi-line style.</summary>
    public static bool Win32SingleLine(IntPtr window, string className) {
        if (window == IntPtr.Zero || className == null) return false;
        bool edit = string.Equals(className, "Edit", StringComparison.OrdinalIgnoreCase) ||
            className.StartsWith("RichEdit", StringComparison.OrdinalIgnoreCase);
        if (!edit) return false;
        const int Style = -16, MultiLine = 0x4;
        return (GetWindowLong(window, Style) & MultiLine) == 0;
    }
    /// <summary>True when the text holds nothing but zero-width anchors and embedded-object markers.</summary>
    public static bool HasOnlyAnchors(string text) {
        foreach (char character in text ?? "") {
            switch ((int)character) {
                case 0xFEFF: case 0x200B: case 0x200C: case 0x200D: case 0x2060: case 0xFFFC: continue;
            }
            return false;
        }
        return true;
    }
    public static bool HasVisibleCharacter(string text) {
        if (string.IsNullOrEmpty(text)) return false;
        foreach (char character in text) {
            // Zero-width anchors editors keep in empty lines, and the embedded-object marker, show nothing.
            switch ((int)character) {
                case 0xFEFF: case 0x200B: case 0x200C: case 0x200D: case 0x2060: case 0xFFFC: continue;
            }
            if (!char.IsWhiteSpace(character)) return true;
        }
        return false;
    }
    // ROLE_SYSTEM_STATICTEXT, ROLE_SYSTEM_TEXT (Firefox's DOM text nodes), ROLE_SYSTEM_WHITESPACE (line breaks).
    const int StaticTextRole = 41, TextRole = 42, WhitespaceRole = 59;
    static int Role(IAccessible accessible) {
        try { object role = accessible.get_accRole(0); return role is int ? (int)role : 0; } catch { return 0; }
    }
    static bool Same(IAccessible first, IAccessible second) {
        IntPtr a = Marshal.GetIUnknownForObject(first), b = Marshal.GetIUnknownForObject(second);
        Marshal.Release(a); Marshal.Release(b);
        return a == b;
    }
    static int State(IAccessible accessible) {
        try { object state = accessible.get_accState(0); return state is int ? (int)state : 0; } catch { return 0; }
    }
    static IntPtr Accessible2(IAccessible accessible) {
        var provider = accessible as IServiceProvider;
        IntPtr result;
        return provider != null && provider.QueryService(ref AccessibleId, ref Accessible2Id, out result) == 0 ? result : IntPtr.Zero;
    }
    static T Slot<T>(IntPtr instance, int slot) where T : class {
        IntPtr table = Marshal.ReadIntPtr(instance);
        return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table, slot * IntPtr.Size), typeof(T)) as T;
    }
    static int Accessible2State(IAccessible accessible) {
        IntPtr instance = Accessible2(accessible);
        if (instance == IntPtr.Zero) return 0;
        try { int states; return Slot<ReadInt>(instance, StatesSlot)(instance, out states) == 0 ? states : 0; }
        finally { Marshal.Release(instance); }
    }
    static string Attributes(IAccessible accessible) {
        IntPtr instance = Accessible2(accessible);
        if (instance == IntPtr.Zero) return null;
        try { string attributes; return Slot<ReadString>(instance, AttributesSlot)(instance, out attributes) == 0 ? attributes ?? "" : null; }
        finally { Marshal.Release(instance); }
    }
}
'@
