import * as parser from '../parser';
import * as fs from 'node:fs';

function cli_main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: ts-node parser.ts <file_path>');
        process.exit(1);
    }
    const filePath = args[0];
    try {
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const lines = fileContents.split('\n');
        const parsed = lines.map(parser.parseInsn);
        console.log(JSON.stringify(parsed, null, 2));
        process.exit(0);
    } catch (error) {
        console.error(`Error reading file: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

cli_main();
