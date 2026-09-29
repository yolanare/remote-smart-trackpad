import { openSync, fstatSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

process.title = 'Remote Smart Trackpad - Console';
console.log('Remote Smart Trackpad - live logs\nClosing this window will not stop the server.\n');
const file = openSync(process.argv[2], 'r');
const buffer = Buffer.alloc(64 * 1024);
const decoder = new StringDecoder('utf8');
let position = Math.max(0, fstatSync(file).size - buffer.length);
function displayLogs() {
  const size = fstatSync(file).size;
  if (size < position) position = 0;
  if (size === position) return;
  const length = readSync(file, buffer, 0, Math.min(size - position, buffer.length), position);
  position += length;
  process.stdout.write(decoder.write(buffer.subarray(0, length)));
}
displayLogs();
setInterval(displayLogs, 100);
