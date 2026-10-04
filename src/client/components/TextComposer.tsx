type TextComposerProps = {
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
};

export function TextComposer({ disabled, value, onChange, onSend }: TextComposerProps) {
  return (
    <form
      className="text-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <label htmlFor="message-input">Text testing · Arabic or English</label>
      <div className="composer-row">
        <textarea
          id="message-input"
          aria-label="Type a message in Arabic or English"
          dir="auto"
          rows={2}
          maxLength={400}
          placeholder="Type in English or Arabic… اكتب بالعربية أو الإنجليزية"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          disabled={disabled}
        />
        <button type="submit" className="button button-primary send-button" disabled={disabled || !value.trim()}>
          Send message
        </button>
      </div>
      <p className="composer-help">Text goes through the same Live session and safety checks as microphone input.</p>
    </form>
  );
}
