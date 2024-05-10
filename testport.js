const net = require('net');

const port = 3001;
const host = 'localhost';

const socket = new net.Socket();

socket.setTimeout(3000);

socket.on('connect', () => {
    console.log(`Port ${port} is open`);
    socket.destroy();
});

socket.on('timeout', () => {
    console.log(`Port ${port} is closed or unreachable`);
    socket.destroy();
});

socket.on('error', (err) => {
    console.error(`Error occurred: ${err.message}`);
});

socket.connect(port, host);
