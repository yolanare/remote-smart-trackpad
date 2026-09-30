// Served over plain HTTP; the remote itself lives on HTTPS at the same host and port.
const secureUrl = `https://${location.host}/`;
document.querySelector('#open').href = secureUrl;

// Show only the steps for this phone; the other platforms stay one tap away.
const agent = navigator.userAgent;
const ios = /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
const platforms = new Set([
    ...(/Android/.test(agent) && !ios ? ['android'] : []),
    ...(ios ? ['ios'] : []),
    ...(/Firefox|FxiOS/.test(agent) && !ios ? ['firefox'] : []),
]);
for (const block of document.querySelectorAll('[data-platform]')) block.hidden = !platforms.has(block.dataset.platform);
document.querySelector('#other-platforms').open = !platforms.size;

// An opaque request succeeds only when the HTTPS certificate is trusted: skip the steps already done.
fetch(`${secureUrl}manifest.webmanifest`, { mode: 'no-cors', cache: 'no-store' })
    .then(() => {
        document.querySelector('#trusted').hidden = false;
        document.body.classList.add('is-trusted');
        document.querySelector('#open').classList.add('primary');
    })
    .catch(() => {});
