const fs = require('fs');
const files = fs.readdirSync('contracts').filter(f => f.endsWith('.sol'));

files.forEach(f => {
    let content = fs.readFileSync('contracts/' + f, 'utf8');
    if (!content.includes('pragma solidity')) {
        content = content.replace('// SPDX-License-Identifier: MIT', '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n');
        fs.writeFileSync('contracts/' + f, content);
        console.log('Added pragma to', f);
    }
});
