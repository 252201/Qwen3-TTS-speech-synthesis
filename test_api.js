import https from 'https';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env.local' });

const apiKey = process.env.VITE_TTS_API_KEY || 'omlx-mpi54dic99snaxxp';
const apiHost = 'https://api.252202.xyz/v1/audio/speech';
const modelId = 'Qwen3-TTS-12Hz-1.7B-Base-8bit';

async function testTTS(name, customPayload) {
    console.log(`\n--- Testing Pattern: ${name} ---`);
    
    // Default base payload
    const payload = {
        model: modelId,
        input: "你好，这是一段测试语音。",
        voice: "alloy", // Standard OpenAI voice
        response_format: "mp3",
        ...customPayload
    };

    const data = JSON.stringify(payload);

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(data)
        }
    };

    return new Promise((resolve) => {
        const req = https.request(apiHost, options, (res) => {
            console.log(`Status: ${res.statusCode}`);
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log(`Success! Received content-type: ${res.headers['content-type']}`);
            }
            
            let responseBody = '';
            res.on('data', (chunk) => {
                if (res.headers['content-type']?.includes('application/json')) {
                    responseBody += chunk.toString();
                } else if (responseBody.length < 50) {
                    responseBody += '[Audio Data...]';
                }
            });

            res.on('end', () => {
                if (res.headers['content-type']?.includes('application/json')) {
                    console.log('Response Error Body:', responseBody);
                }
                resolve(res.statusCode);
            });
        });

        req.on('error', (e) => {
            console.error(`Problem with request: ${e.message}`);
            resolve(500);
        });

        req.write(data);
        req.end();
    });
}

async function runTests() {
    console.log("Starting API Probing...");
    
    await testTTS("Standard OpenAI Request", {});

    await testTTS("OpenAI with extra_body (VLLM style)", {
        extra_body: {
            references: [
                {
                    audio: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
                    text: "测试参考"
                }
            ]
        }
    });

    await testTTS("Top level reference_audio", {
        reference_audio: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
        reference_text: "测试参考"
    });
}

runTests();
