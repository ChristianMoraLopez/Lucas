import { LottieSlot } from '@/components/lucas-ui';

export function PlaceholderTab({ title, text }: { title: string; text: string }) {
  return (
    <div className="ph">
      <LottieSlot name="vacio" width={96} height={96} />
      <h1 className="lu-title">{title}</h1>
      <p className="lu-small lu-muted" style={{ margin: 0, maxWidth: '40ch' }}>
        {text}
      </p>
    </div>
  );
}
