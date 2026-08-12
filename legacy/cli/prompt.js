import readline from 'readline';
import fs from 'fs';
import path from 'path';

export class InteractivePrompt {
    constructor() {
        this.input = '';
        this.cursor = 0;
        this.inMenu = false;
        this.menuOptions = [];
        this.menuIndex = 0;
        this.query = '';
    }

    async ask(message) {
        return new Promise((resolve) => {
            this.input = '';
            this.cursor = 0;
            this.inMenu = false;
            this.resolve = resolve;
            
            process.stdout.write(message + ' ');
            
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }

            this.keypressHandler = (str, key) => this.handleKeypress(str, key, message);
            process.stdin.on('keypress', this.keypressHandler);
        });
    }

    getFiles(query) {
        try {
            const cwd = process.cwd();
            const files = fs.readdirSync(cwd).filter(f => !f.startsWith('.'));
            return files.filter(f => f.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
        } catch {
            return [];
        }
    }

    render(message) {
        // Clear current line and all below
        readline.cursorTo(process.stdout, 0);
        readline.clearScreenDown(process.stdout);
        
        process.stdout.write(`${message} ${this.input}`);
        
        if (this.inMenu && this.menuOptions.length > 0) {
            process.stdout.write('\n');
            this.menuOptions.forEach((opt, idx) => {
                readline.clearLine(process.stdout, 0);
                readline.cursorTo(process.stdout, 0);
                if (idx === this.menuIndex) {
                    process.stdout.write(`  > \x1b[36m${opt}\x1b[0m\n`);
                } else {
                    process.stdout.write(`    ${opt}\n`);
                }
            });
            // Move cursor back up
            readline.moveCursor(process.stdout, 0, -this.menuOptions.length - 1);
        } else if (this.inMenu) {
            process.stdout.write('\n    \x1b[90m(no matches)\x1b[0m\n');
            readline.moveCursor(process.stdout, 0, -2);
        }

        // Adjust cursor position to the actual input cursor
        const actualCursorPos = message.length + 1 + this.cursor;
        readline.cursorTo(process.stdout, actualCursorPos);
    }

    handleKeypress(str, key, message) {
        if (key.ctrl && key.name === 'c') {
            process.exit(0);
        }

        if (key.name === 'return') {
            if (this.inMenu && this.menuOptions.length > 0) {
                // Select option
                const selected = this.menuOptions[this.menuIndex];
                // Replace the @query with the selected item
                const beforeAt = this.input.slice(0, this.cursor).replace(/@[^@\s]*$/, '');
                const afterAt = this.input.slice(this.cursor);
                this.input = beforeAt + '@' + selected + ' ' + afterAt;
                this.cursor = beforeAt.length + selected.length + 2;
                this.inMenu = false;
                
                this.render(message);
                return;
            }

            // Normal submit
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            process.stdin.removeListener('keypress', this.keypressHandler);
            
            readline.cursorTo(process.stdout, 0);
            readline.clearScreenDown(process.stdout);
            process.stdout.write(`${message} ${this.input}\n`);
            
            this.resolve(this.input);
            return;
        }

        if (key.name === 'tab') {
            if (this.inMenu && this.menuOptions.length > 0) {
                const selected = this.menuOptions[this.menuIndex];
                const beforeAt = this.input.slice(0, this.cursor).replace(/@[^@\s]*$/, '');
                const afterAt = this.input.slice(this.cursor);
                this.input = beforeAt + '@' + selected + ' ' + afterAt;
                this.cursor = beforeAt.length + selected.length + 2;
                this.inMenu = false;
            } else {
                const beforeCursor = this.input.slice(0, this.cursor);
                const words = beforeCursor.split(/\s+/);
                const lastWord = words[words.length - 1];
                
                if (lastWord.length > 0) {
                    try {
                        let dir = process.cwd();
                        let filePrefix = lastWord;
                        let dirPrefix = '';
                        
                        if (lastWord.includes('/')) {
                            const parts = lastWord.split('/');
                            filePrefix = parts.pop();
                            dirPrefix = parts.join('/') + '/';
                            dir = path.resolve(dir, dirPrefix);
                        }
                        
                        const files = fs.readdirSync(dir);
                        const matches = files.filter(f => f.startsWith(filePrefix));
                        
                        if (matches.length === 1) {
                            let match = matches[0];
                            const isDir = fs.statSync(path.join(dir, match)).isDirectory();
                            if (isDir) match += '/';
                            
                            const completion = match.slice(filePrefix.length);
                            const afterCursor = this.input.slice(this.cursor);
                            this.input = beforeCursor + completion + afterCursor;
                            this.cursor += completion.length;
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            }
            this.render(message);
            return;
        }

        if (key.name === 'backspace') {
            if (this.cursor > 0) {
                const charDeleted = this.input[this.cursor - 1];
                this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
                this.cursor--;
                
                if (charDeleted === '@') {
                    this.inMenu = false;
                } else if (this.inMenu) {
                    this.query = this.query.slice(0, -1);
                    this.menuOptions = this.getFiles(this.query);
                    this.menuIndex = 0;
                }
            }
        } else if (key.name === 'left') {
            if (this.cursor > 0) this.cursor--;
        } else if (key.name === 'right') {
            if (this.cursor < this.input.length) this.cursor++;
        } else if (this.inMenu && key.name === 'up') {
            if (this.menuIndex > 0) this.menuIndex--;
        } else if (this.inMenu && key.name === 'down') {
            if (this.menuIndex < this.menuOptions.length - 1) this.menuIndex++;
        } else if (str) {
            this.input = this.input.slice(0, this.cursor) + str + this.input.slice(this.cursor);
            this.cursor += str.length;

            if (str === '@') {
                this.inMenu = true;
                this.query = '';
                this.menuOptions = this.getFiles(this.query);
                this.menuIndex = 0;
            } else if (this.inMenu && !/\s/.test(str)) {
                this.query += str;
                this.menuOptions = this.getFiles(this.query);
                this.menuIndex = 0;
            } else if (this.inMenu && /\s/.test(str)) {
                this.inMenu = false;
            }
        }

        this.render(message);
    }
}
