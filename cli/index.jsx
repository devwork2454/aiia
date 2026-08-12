import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import TextInput from 'ink-text-input';

const App = () => {
    const [input, setInput] = useState('');
    const [chat, setChat] = useState([]);
    const [logs, setLogs] = useState([]);

    useEffect(() => {
        // Hijack console.log to feed into the right panel logs
        const originalLog = console.log;
        console.log = (...args) => {
            const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
            setLogs(prev => [...prev, msg].slice(-15)); // Keep last 15 logs
        };
        
        // Simulating some Pi engine logs coming in the background
        const iv = setInterval(() => {
            console.log(`[AIIA Engine] Background tick ${new Date().getSeconds()}s`);
        }, 2000);
        
        return () => {
            console.log = originalLog;
            clearInterval(iv);
        };
    }, []);

    const handleSubmit = (val) => {
        if (!val.trim()) return;
        if (val.toLowerCase() === 'exit') {
            process.exit(0);
        }

        setChat(prev => [...prev, { role: 'user', content: val }].slice(-10));
        setInput('');
        
        // Simulate Pi thinking and replying
        setTimeout(() => {
            console.log(`[Tool Call] Executing WebSearch...`);
        }, 500);
        
        setTimeout(() => {
            setChat(prev => [...prev, { role: 'agent', content: `Echoing back your instruction: ${val}` }].slice(-10));
            console.log(`[Turn Finished] Generated response for user.`);
        }, 1500);
    };

    return (
        <Box flexDirection="row" width="100%" height={24}>
            {/* Left Panel: Chat Area */}
            <Box flexDirection="column" width="70%" borderStyle="round" borderColor="green" padding={1}>
                <Text bold color="cyan">🤖 AIIA CLI (Ink TUI) - Main Chat</Text>
                <Text color="gray">Type 'exit' to quit. @ mention support coming to Ink soon.</Text>
                <Text>---</Text>
                <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
                    {chat.map((msg, idx) => (
                        <Text key={idx} color={msg.role === 'user' ? 'blue' : 'white'}>
                            {msg.role === 'user' ? 'You: ' : 'Pi: '}{msg.content}
                        </Text>
                    ))}
                </Box>
                <Box marginTop={1}>
                    <Text color="green">? You: </Text>
                    <Box flexGrow={1}>
                        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
                    </Box>
                </Box>
            </Box>

            {/* Right Panel: Status / Log Area */}
            <Box flexDirection="column" width="30%" borderStyle="round" borderColor="gray" padding={1}>
                <Text color="yellow" bold>System Logs</Text>
                <Text color="gray">---</Text>
                <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
                    {logs.map((log, idx) => (
                        <Text key={idx} color="gray">{log}</Text>
                    ))}
                </Box>
            </Box>
        </Box>
    );
};

render(<App />);
