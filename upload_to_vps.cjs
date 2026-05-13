const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
    conn.sftp((err, sftp) => {
        if (err) throw err;
        
        console.log("Uploading specialized_agents.json...");
        sftp.fastPut('specialized_agents.json', '/root/synapsemesh-agent/specialized_agents.json', (err) => {
            if (err) throw err;
            console.log("Uploaded specialized_agents.json");
            
            console.log("Uploading swarm.js...");
            sftp.fastPut('swarm.js', '/root/synapsemesh-agent/swarm.js', (err) => {
                if (err) throw err;
                console.log("Uploaded swarm.js");
                conn.end();
            });
        });
    });
}).connect({
    host: '144.91.76.243',
    port: 22,
    username: 'root',
    privateKey: fs.readFileSync(require('path').join(require('os').homedir(), '.ssh', 'synapsemesh_key'))
});
