import { useState } from 'react';

function AIChat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    { sender: 'ai', text: 'Hello, Doctor. I am your Neural-Kinematic AI. How can I assist you with patient data today?' }
  ]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    
    const userMsg = { sender: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    try {
      const response = await fetch("http://127.0.0.1:8000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.text })
      });
      const data = await response.json();
      setMessages(prev => [...prev, { sender: 'ai', text: data.reply }]);
    } catch (error) {
      console.error("Chat error:", error);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 mt-6 h-96 flex flex-col">
      <h2 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Medical AI Assistant</h2>
      
      <div className="flex-1 overflow-y-auto mb-4 space-y-3 p-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs p-3 rounded-lg text-sm ${msg.sender === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      <div className="flex space-x-2 mt-auto">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Ask about symmetry, squats, or recovery..." 
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={sendMessage} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700">
          Send
        </button>
      </div>
    </div>
  );
}

export default AIChat;