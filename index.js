const express = require('express');
const net = require('net');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-hiwa-token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Simple token auth for protected endpoints ──
function requireToken(req, res, next) {
  const token = req.headers['x-hiwa-token'];
  if (!process.env.HIWA_AUTH_TOKEN) return next(); // no token configured = open (dev mode)
  if (token !== process.env.HIWA_AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function sendRcon(host, port, password, command) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let authenticated = false;
    let buffer = Buffer.alloc(0);

    client.connect(port, host, () => {
      client.write(buildPacket(0, 3, password));
    });

    client.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 12) {
        const length = buffer.readInt32LE(0);
        if (buffer.length < length + 4) break;
        const body = buffer.slice(12, length + 2).toString('utf8').replace(/\0/g, '');
        buffer = buffer.slice(length + 4);
        if (!authenticated) {
          authenticated = true;
          client.write(buildPacket(1, 2, command));
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

// ── Raw command (unchanged from original) ──
app.post('/command', requireToken, async (req, res) => {
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

// ── Shop delivery endpoint: give item to player ──
// Called by shop.html after a successful purchase on server 0
// Body: { player: "MinecraftUsername", rcon_command: "give {player} diamond 1" }
app.post('/deliver', requireToken, async (req, res) => {
  const { player, rcon_command } = req.body;

  if (!player || !rcon_command) {
    return res.status(400).json({ error: 'Missing player or rcon_command' });
  }

  // Sanitize player name (only allow alphanumeric + underscore, max 16 chars)
  if (!/^[a-zA-Z0-9_]{1,16}$/.test(player)) {
    return res.status(400).json({ error: 'Invalid Minecraft username' });
  }

  // Replace {player} placeholder with actual username
  const finalCommand = rcon_command.replace(/\{player\}/g, player);

  try {
    const result = await sendRcon(
      process.env.RCON_HOST,
      parseInt(process.env.RCON_PORT),
      process.env.RCON_PASSWORD,
      finalCommand
    );
    res.json({ success: true, result, command: finalCommand });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Multi-deliver: send multiple commands at once (for kits) ──
app.post('/deliver-kit', requireToken, async (req, res) => {
  const { player, commands } = req.body;

  if (!player || !Array.isArray(commands) || commands.length === 0) {
    return res.status(400).json({ error: 'Missing player or commands array' });
  }
  if (!/^[a-zA-Z0-9_]{1,16}$/.test(player)) {
    return res.status(400).json({ error: 'Invalid Minecraft username' });
  }

  const results = [];
  for (const cmd of commands) {
    try {
      const finalCmd = cmd.replace(/\{player\}/g, player);
      const result = await sendRcon(
        process.env.RCON_HOST,
        parseInt(process.env.RCON_PORT),
        process.env.RCON_PASSWORD,
        finalCmd
      );
      results.push({ command: finalCmd, result, ok: true });
    } catch (e) {
      results.push({ command: cmd, error: e.message, ok: false });
    }
  }

  const allOk = results.every(r => r.ok);
  res.json({ success: allOk, results });
});

app.get('/', (req, res) => res.send('HIWA RCON Bridge is running!'));

app.listen(38674, () => {
  console.log('HIWA RCON Bridge on port 38674');
});
