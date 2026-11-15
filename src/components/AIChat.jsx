import { useState } from 'react';

function AIChat() {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState([
    {
      sender: 'ai',
      text: 'Neural-Kinematic Clinical Assistant ready. Ask about joint ROM thresholds, compensation patterns, or carpal tunnel pinch kinematics.',
    },
  ]);

  const sendMessage = async () => {
    if (!input.trim() || isSending) return;

    const userMsg = { sender: 'user', text: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsSending(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.text }),
      });
      const data = await response.json();
      setMessages((prev) => [...prev, { sender: 'ai', text: data.reply }]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        { sender: 'ai', text: 'Unable to reach clinical assistant endpoint.' },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="bg-slate-900/80 backdrop-blur-md p-6 rounded-xl border border-slate-800 h-[34rem] flex flex-col">
      <div className="border-b border-slate-800 pb-4 mb-4">
        <h2 className="text-lg font-semibold text-slate-100 tracking-tight">
          Biomechanical Consultation
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Clinical Q&amp;A &amp; Protocol Guidance</p>
      </div>

      <div className="flex-1 overflow-y-auto mb-4 space-y-3 pr-1">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] px-3.5 py-2.5 rounded-lg text-sm leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-cyan-500 text-slate-950 font-medium'
                  : 'bg-slate-950/90 text-slate-200 border border-slate-800'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex justify-start">
            <div className="px-3.5 py-2 rounded-lg text-xs font-mono text-slate-400 bg-slate-950/90 border border-slate-800">
              Analyzing clinical query...
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-auto">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Ask about symmetry, jerk RMS, or pinch ROM..."
          className="flex-1 bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
        <button
          onClick={sendMessage}
          disabled={isSending}
          className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default AIChat;