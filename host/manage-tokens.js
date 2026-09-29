import readline from 'node:readline';
import { once } from 'node:events';

const url = `http://127.0.0.1:${process.env.REMOTE_SMART_TRACKPAD_PORT || 8765}/api/setup/tokens`;
async function request(method = 'GET', id) {
    const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Trackpad-Local': '1' },
        ...(id ? { body: JSON.stringify({ id }) } : {}),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    return response.json();
}
let selected = 0,
    confirm = false;
try {
    if (!process.stdin.isTTY) throw new Error('Open this manager in a terminal.');
    let records = await request();
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    const draw = () => {
        console.clear();
        console.log('Remote Smart Trackpad - device access\n');
        records.forEach((record, index) =>
            console.log(
                `${index === selected ? '>' : ' '} ${record.name || 'Unnamed device'} | ${record.firstConnectedAt ? new Date(record.firstConnectedAt).toLocaleString() : 'First connection unknown (legacy token)'} | ${record.id}`
            )
        );
        if (!records.length) console.log('No paired devices.');
        console.log(
            confirm ? '\nRevoke this device now? Y / N' : '\nUp/Down: select   Delete: revoke   R: refresh   Q: exit'
        );
    };
    draw();
    while (true) {
        const [character, key] = await once(process.stdin, 'keypress');
        if (key.name === 'q' || (key.ctrl && key.name === 'c')) break;
        if (confirm) {
            if (character?.toLowerCase() === 'y') records = await request('DELETE', records[selected].id);
            confirm = false;
        } else if (key.name === 'up') selected--;
        else if (key.name === 'down') selected++;
        else if (key.name === 'delete' && records.length) confirm = true;
        else if (key.name === 'r') records = await request();
        selected = Math.max(0, Math.min(selected, records.length - 1));
        draw();
    }
} catch (error) {
    console.error(`Cannot manage access: ${error.message}\nStart the server, then reopen this manager.`);
    process.exitCode = 1;
} finally {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
}
