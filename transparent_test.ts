import { GoogleGenerativeAI } from '@google/generative-ai';

async function runTest() {
    // We pass a dummy key because the Gateway will inject the real one from llm.env!
    const genAI = new GoogleGenerativeAI('DUMMY_KEY');
    
    // Override fetch to point to our gateway instead of Google directly
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        let url = typeof input === 'string' ? input : (input as Request).url;
        
        // Redirect Google API calls to our local gateway
        if (url.startsWith('https://generativelanguage.googleapis.com')) {
            url = url.replace('https://generativelanguage.googleapis.com', 'http://localhost:9000/gemini');
        }
        
        console.log(`\n[Client] Fetching: ${url}`);
        return originalFetch(url, init);
    };

    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        systemInstruction: "You are a highly sarcastic robot. Always reply with sarcasm."
    });

    console.log("Testing standard request (with System Instructions)...");
    const result = await model.generateContent("Tell me about the weather.");
    console.log("Response:", result.response.text());

    console.log("\nTesting streaming request...");
    const stream = await model.generateContentStream("Count from 1 to 5 slowly.");
    for await (const chunk of stream) {
        process.stdout.write(chunk.text());
    }
    console.log('\n[Done]');
}

runTest().catch(console.error);
