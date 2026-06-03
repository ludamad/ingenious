// Online chat panel. Subscribes to the OnlineMatch store, shows the rolling log
// (system lines styled differently), and sends messages. Used in the lobby and
// in-game. Auto-scrolls to the newest line and clears the unread badge while open.
import { useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import type { OnlineMatch } from "../match/OnlineMatch";

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function Chat({ match, compact }: { match: OnlineMatch; compact?: boolean }) {
  useSyncExternalStore((cb) => match.onUpdate(cb), () => match.version());
  const log = match.chat();
  const mySeat = match.mySeatIndex();
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  // keep pinned to the latest message; clear unread since the panel is visible
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    match.markChatRead();
  }, [log.length, match]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    match.sendChat(text);
    setText("");
  }

  return (
    <div className={"chat" + (compact ? " compact" : "")}>
      <div className="chat-log" ref={scroller}>
        {log.length === 0 && <p className="chat-empty">No messages yet — say hi 👋</p>}
        {log.map((m, i) =>
          m.system ? (
            <div key={i} className="chat-line system">{m.text}</div>
          ) : (
            <div key={i} className={"chat-line" + (m.seat === mySeat ? " mine" : "")}>
              <span className="chat-who">{m.name}</span>
              <span className="chat-text">{m.text}</span>
              <span className="chat-time">{fmtTime(m.ts)}</span>
            </div>
          ),
        )}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Message…" maxLength={300} aria-label="Chat message" />
        <button className="ghost" type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
