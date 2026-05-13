const fs = require('fs');
const files = fs.readdirSync('contracts').filter(f => f.endsWith('.sol'));

files.forEach(f => {
    let content = fs.readFileSync('contracts/' + f, 'utf8');
    if (content.includes('\\n')) {
        content = content.replace(/\\n/g, '\n');
        fs.writeFileSync('contracts/' + f, content);
        console.log('Fixed \\n in', f);
    }
});
