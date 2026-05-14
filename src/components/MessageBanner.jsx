export function MessageBanner({ message }) {
  if (!message) return null;
  return (
    <div className="mt-4 rounded-lg border border-[#ee604b]/45 bg-[#ee604b]/12 px-3.5 py-3 text-sm text-[#ffd3c9]">
      {message}
    </div>
  );
}
