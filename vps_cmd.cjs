const { Client } = require('ssh2');
const fs = require('fs');

const config = {
  host: '144.91.76.243',
  port: 22,
  username: 'root',
  privateKey: fs.readFileSync('C:\\Users\\LINO ALEMZ\\.ssh\\synapsemesh_key')
};

const cmd = process.argv.slice(2).join(' ');

if (!cmd) {
  console.error('Usage: node vps_cmd.cjs <command>');
  process.exit(1);
}

const conn = new Client();
conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('close', (code, signal) => {
      conn.end();
      process.exit(code);
    }).on('data', (data) => {
      process.stdout.write(data);
    }).stderr.on('data', (data) => {
      process.stderr.write(data);
    });
  });
}).on('error', (err) => {
  console.error('SSH Error:', err.message);
  process.exit(1);
}).connect(config);
