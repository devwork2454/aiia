import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import TextInput from 'ink-text-input';

import { createAgentSession } from '@earendil-works/pi-coding-agent';

const App = () => {
    const [input, setInput] = useState('');
    const [chat, setChat] = useState([]);
    const [logs, setLogs] = useState([]);
    const [session, setSession] = useState(null);

    useEffect(() => {
        // Hijack console.log to feed into the right panel logs
        const originalLog = console.log;
        console.log = (...args) => {
            const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
            setLogs(prev => [...prev, msg].slice(-25)); // Keep last 25 logs
        };
        
        createAgentSession({ cwd: process.cwd() }).then(res => {
            setSession(res.session);
            console.log(`[AIIA Engine] Pi session initialized. Model: ${res.session.model?.id || 'unknown'}`);
        }).catch(err => {
            console.log(`[AIIA Engine Error] Failed to initialize: ${err.message}`);
        });
        
        return () => {
            console.log = originalLog;
        };
    }, []);

    const handleSubmit = async (val) => {
        if (!val.trim()) return;
        if (val.toLowerCase() === 'exit') {
            process.exit(0);
        }

        setChat(prev => [...prev, { role: 'user', content: val }].slice(-10));
        setInput('');
        
        if (session) {
            console.log(`[AIIA Engine] Submitting prompt...`);
            try {
                await session.prompt(val);
                const lastMsg = session.messages[session.messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                    const text = Array.isArray(lastMsg.content) 
                        ? lastMsg.content.find(c => c.type === 'text')?.text || '[Tool execution finished]'
                        : (lastMsg.content || '[Empty response]');
                    setChat(prev => [...prev, { role: 'agent', content: text }].slice(-10));
                }
            } catch (err) {
                console.log(`[AIIA Engine Error] ${err.message}`);
                setChat(prev => [...prev, { role: 'agent', content: `[Error]: ${err.message}` }].slice(-10));
            }
        } else {
            console.log(`[AIIA Engine] Wait, session not ready!`);
        }
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
