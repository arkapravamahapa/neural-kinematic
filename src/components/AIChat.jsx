import { useEffect, useRef, useState } from 'react';

const INITIAL_MESSAGE = {
  sender: 'ai',
  text: 'Neural-Kinematic Clinical Assistant ready. Ask about joint ROM thresholds, compensation patterns, or carpal tunnel pinch kinematics.',
};

const QUICK_PROMPTS = [
  'Safe ROM limits for early ACL knee flexion?',
  'How to correct trunk lean during squats?',
  'Target pinch aperture for carpal tunnel rehab?',
];

function AIChat() {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const sendMessage = async (overrideText) => {
    const query = (typeof overrideText === 'string' ? overrideText : input).trim();
    if (!query || isSending) return;

    const userMsg = { sender: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    if (typeof overrideText !== 'string') setInput('');
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
    <div className="bg-green-50 p-5 rounded-xl border border-green-200 h-[38rem] flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-green-200 pb-3 mb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 tracking-tight">
            Biomechanical Consultation
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">Clinical Q&amp;A &amp; Protocol Guidance</p>
        </div>
        <button
          type="button"
          onClick={() => setMessages([INITIAL_MESSAGE])}
          className="px-2.5 py-1 rounded border border-green-300 bg-green-100/70 hover:bg-green-200/70 text-xs font-mono text-slate-700 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Quick Clinical Prompts */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={isSending}
            onClick={() => sendMessage(prompt)}
            className="text-[11px] text-left bg-green-100/60 hover:bg-green-200/70 disabled:opacity-50 border border-green-200 text-slate-800 px-2.5 py-1 rounded-md transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto mb-3 space-y-2.5 pr-1">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] px-3.5 py-2.5 rounded-lg text-sm leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-green-300 text-slate-950 border border-green-400 font-medium'
                  : 'bg-green-100/60 text-slate-800 border border-green-200'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex justify-start">
            <div className="px-3.5 py-2 rounded-lg text-xs font-mono text-slate-600 bg-green-100/60 border border-green-200">
              Analyzing clinical query...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 mt-auto">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Ask about symmetry, jerk RMS, or pinch ROM..."
          className="flex-1 bg-green-50 border border-green-300 text-slate-900 placeholder:text-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
        <button
          type="button"
          onClick={() => sendMessage()}
          disabled={isSending}
          className="bg-green-300 hover:bg-green-200 disabled:opacity-50 text-slate-950 border border-green-400 px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default AIChat;