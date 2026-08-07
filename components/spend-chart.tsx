import { spendSeries } from "@/lib/mock-data";

export function SpendChart() {
  const max = Math.max(...spendSeries.map((d) => d.amount));
  const width = 640;
  const height = 160;
  const padX = 8;
  const step = (width - padX * 2) / (spendSeries.length - 1);

  const points = spendSeries.map((d, i) => {
    const x = padX + i * step;
    const y = height - 16 - (d.amount / max) * (height - 40);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${padX},${height - 16} ${line} ${width - padX},${height - 16}`;

  return (
    <div className="px-5 pb-4 pt-5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        role="img"
        aria-label="Daily spend over the last 30 days"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-lemon-400)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-lemon-400)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={padX}
            x2={width - padX}
            y1={16 + f * (height - 32)}
            y2={16 + f * (height - 32)}
            stroke="var(--color-ink-100)"
            strokeWidth="1"
          />
        ))}
        <polygon points={area} fill="url(#spendFill)" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--color-lemon-500)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="2.5"
            fill="white"
            stroke="var(--color-lemon-600)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-[0.7rem] text-ink-400">
        {spendSeries.map((d) => (
          <span key={d.day} className="hidden sm:block">
            {d.day}
          </span>
        ))}
        <span className="sm:hidden">{spendSeries[0].day}</span>
        <span className="sm:hidden">
          {spendSeries[spendSeries.length - 1].day}
        </span>
      </div>
    </div>
  );
}
