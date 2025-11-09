// frontend/components/Toast.tsx
type Props = { message: string; onClose?: () => void };

export default function Toast({ message, onClose }: Props) {
  return (
    <div className="toast fade-up">
      <div className="flex items-center gap-2">
        <span>⚠️</span>
        <span>{message}</span>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-2 text-white/70 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
