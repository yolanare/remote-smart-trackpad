/**
 * The phone's options (CONTEXT.md): their values, defaults and validity, remembered in `storage`.
 *
 * schema: { name: { default, valid(value) → boolean } }. storage: { load() → stored object or undefined, save(values),
 * clear() }; it may throw (private browsing), which only loses the memory. Stored values that are invalid or no
 * longer an option are dropped.
 *
 * values is live and read-only for callers; set() and reset() change it and tell every onChange(callback) listener
 * the names that changed, after the change.
 */
export function createOptions(schema, storage) {
    const defaults = Object.fromEntries(Object.entries(schema).map(([name, { default: value }]) => [name, value]));
    const values = { ...defaults };
    const listeners = [];
    const quietly = (action) => {
        try {
            return action();
        } catch {}
    };
    const stored = quietly(() => storage.load()) ?? {};
    for (const [name, value] of Object.entries(stored))
        if (name in schema && schema[name].valid(value)) values[name] = value;
    // Options renamed or removed leave their old values behind: forget them.
    if (Object.keys(stored).some((name) => !(name in schema))) quietly(() => storage.save(values));
    const changed = (names) => {
        for (const listener of listeners) listener(names);
    };
    return {
        values,
        defaults,
        /** Sets an option; an invalid or unchanged value does nothing. */
        set(name, value) {
            if (!(name in schema) || !schema[name].valid(value) || values[name] === value) return;
            values[name] = value;
            quietly(() => storage.save(values));
            changed([name]);
        },
        /** Every option back to its default, and nothing remembered. */
        reset() {
            const names = Object.keys(values).filter((name) => values[name] !== defaults[name]);
            Object.assign(values, defaults);
            quietly(() => storage.clear());
            if (names.length) changed(names);
        },
        onChange(listener) {
            listeners.push(listener);
        },
    };
}
