const express = require('express');
const net = require('net');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

function sendRcon(host, port, password, command) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let authenticated = false;
    let buffer = Buffer.alloc(0);

    client.connect(port, host, () => {
      const passPacket = buildPacket(0, 3, password);
      client.write(passPacket);
    });

    client.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 12) {
        const length = buffer.readInt32LE(0);
        if (buffer.length < length + 4) break;
        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const body = buffer.slice(12, length + 2).toString('utf8').replace(/\0/g, '');
        buffer = buffer.slice(length + 4);
        if (!authenticated) {
          authenticated = true;
          const cmdPacket = buildPacket(1, 2, command);
          client.write(cmdPacket);
        } else {
          client.destroy();
          resolve(body);
        }
      }
    });

    client.on('error', reject);
    setTimeout(() => { client.destroy(); reject(new Error('Timeout')); }, 5000);
  });
}

function buildPacket(id, type, body) {
  const bodyBuf = Buffer.from(body + '\0\0', 'utf8');
  const packet = Buffer.alloc(4 + 4 + 4 + bodyBuf.length);
  packet.writeInt32LE(8 + bodyBuf.length, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  bodyBuf.copy(packet, 12);
  return packet;
}

app.post('/command', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'No command' });
  try {
    const result = await sendRcon(
      process.env.RCON_HOST,
      parseInt(process.env.RCON_PORT),
      process.env.RCON_PASSWORD,
      command
    );
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.send('RCON Server is running!'));

app.listen(process.env.PORT || 3000, () => console.log('Server started'));
