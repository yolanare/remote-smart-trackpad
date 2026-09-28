using System;
using System.Threading;
using System.Windows.Automation;

public sealed class SessionEvents : IDisposable {
    private readonly AutomationElement element;
    private readonly AutomationEventHandler textHandler;
    private readonly AutomationEventHandler selectionHandler;
    private readonly AutomationFocusChangedEventHandler focusHandler;
    private long revision;
    private bool disposed;
    public bool TextSubscribed { get; private set; }
    public bool SelectionSubscribed { get; private set; }
    public bool FocusSubscribed { get; private set; }
    public long Revision { get { return Interlocked.Read(ref revision); } }

    public SessionEvents(AutomationElement target) {
        element = target;
        textHandler = delegate(object sender, AutomationEventArgs args) { Interlocked.Increment(ref revision); };
        selectionHandler = delegate(object sender, AutomationEventArgs args) { Interlocked.Increment(ref revision); };
        focusHandler = delegate(object sender, AutomationFocusChangedEventArgs args) { Interlocked.Increment(ref revision); };
        try {
            Automation.AddAutomationEventHandler(TextPattern.TextChangedEvent, element, TreeScope.Element, textHandler);
            TextSubscribed = true;
        } catch (InvalidOperationException) { }
          catch (System.Runtime.InteropServices.COMException) { }
        try {
            Automation.AddAutomationEventHandler(TextPattern.TextSelectionChangedEvent, element, TreeScope.Element, selectionHandler);
            SelectionSubscribed = true;
        } catch (InvalidOperationException) { }
          catch (System.Runtime.InteropServices.COMException) { }
        try {
            Automation.AddAutomationFocusChangedEventHandler(focusHandler);
            FocusSubscribed = true;
        } catch (InvalidOperationException) { }
          catch (System.Runtime.InteropServices.COMException) { }
    }

    public void Dispose() {
        if (disposed) return;
        disposed = true;
        if (TextSubscribed) Remove(TextPattern.TextChangedEvent, textHandler);
        if (SelectionSubscribed) Remove(TextPattern.TextSelectionChangedEvent, selectionHandler);
        if (FocusSubscribed) {
            try { Automation.RemoveAutomationFocusChangedEventHandler(focusHandler); }
            catch (InvalidOperationException) { }
            catch (System.Runtime.InteropServices.COMException) { }
        }
    }

    private void Remove(AutomationEvent eventId, AutomationEventHandler handler) {
        try { Automation.RemoveAutomationEventHandler(eventId, element, handler); }
        catch (InvalidOperationException) { }
        catch (System.Runtime.InteropServices.COMException) { }
    }
}
