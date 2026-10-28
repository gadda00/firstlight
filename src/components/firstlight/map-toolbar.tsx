/* FirstLight — map toolbar: layer toggles, swipe switch, base style,
 * and the transparent need-score weight sliders (partner-tunable). */

'use client';

import { useMemo } from 'react';
import { Layers, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { useFirstLight, type LayerVisibility } from '@/store/firstlight';
import { DEFAULT_WEIGHTS } from '@/lib/firstlight/decision';

const LAYER_META: { key: keyof LayerVisibility; label: string }[] = [
  { key: 'damage', label: 'Damage points' },
  { key: 'undamaged', label: 'Undamaged bldgs' },
  { key: 'flood', label: 'Flood extent' },
  { key: 'zones', label: 'H3 priority zones' },
  { key: 'roads', label: 'Road network' },
  { key: 'facilities', label: 'Facilities' },
  { key: 'routes', label: 'Routes' },
];

export function MapToolbar() {
  const layers = useFirstLight((s) => s.layers);
  const toggleLayer = useFirstLight((s) => s.toggleLayer);
  const swipe = useFirstLight((s) => s.swipe);
  const setSwipe = useFirstLight((s) => s.setSwipe);
  const baseStyle = useFirstLight((s) => s.baseStyle);
  const setBaseStyle = useFirstLight((s) => s.setBaseStyle);
  const weights = useFirstLight((s) => s.weights);
  const setWeights = useFirstLight((s) => s.setWeights);
  const resetWeights = useFirstLight((s) => s.resetWeights);

  const weightSum = useMemo(
    () => weights.w1 + weights.w2 + weights.w3 + weights.w4,
    [weights],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-zinc-800/80 bg-zinc-950">
      <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
        <Layers className="h-3.5 w-3.5" />
        LAYERS
      </div>
      <div className="flex flex-wrap gap-1">
        {LAYER_META.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => toggleLayer(key)}
            className={`text-[10px] font-semibold rounded-md px-2 py-1 border transition-colors ${
              layers[key]
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-zinc-700/60 bg-zinc-900 text-zinc-500 hover:border-zinc-600'
            }`}
            aria-pressed={layers[key]}
          >
            {label}
          </button>
        ))}
      </div>

      <Separator orientation="vertical" className="h-5 !bg-zinc-800 hidden sm:block" />

      {/* swipe + base */}
      <div className="flex items-center gap-2">
        <Label htmlFor="swipe-switch" className="text-[10px] font-semibold text-zinc-400">
          PRE/POST SWIPE
        </Label>
        <Switch
          id="swipe-switch"
          checked={swipe}
          onCheckedChange={setSwipe}
          className="scale-90 data-[state=checked]:bg-amber-500"
        />
      </div>
      <div className="flex items-center gap-1">
        {(['satellite', 'dark'] as const).map((b) => (
          <button
            key={b}
            onClick={() => setBaseStyle(b)}
            className={`text-[10px] font-semibold rounded-md px-2 py-1 border transition-colors ${
              baseStyle === b
                ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
                : 'border-zinc-700/60 bg-zinc-900 text-zinc-500 hover:border-zinc-600'
            }`}
          >
            {b === 'satellite' ? 'SATELLITE' : 'DARK OPS'}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* weights popover */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-[11px] border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-500/50"
          >
            <SlidersHorizontal className="h-3 w-3" />
            Need-score weights
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 bg-zinc-900 border-zinc-700" align="end">
          <div className="space-y-3">
            <div className="text-xs font-semibold text-zinc-200">
              need(z) = w₁·D + w₂·Pexp + w₃·Iso + w₄·Crit
            </div>
            <p className="text-[10px] leading-relaxed text-zinc-500">
              Transparent and tunable with partner agencies — per the decision-layer
              blueprint. Scores renormalize to Σw = 1.
            </p>
            <WeightSlider
              label="w₁ Damage ratio D(z)"
              value={weights.w1}
              onChange={(v) => setWeights({ ...weights, w1: v })}
            />
            <WeightSlider
              label="w₂ Exposed population"
              value={weights.w2}
              onChange={(v) => setWeights({ ...weights, w2: v })}
            />
            <WeightSlider
              label="w₃ Isolation delta"
              value={weights.w3}
              onChange={(v) => setWeights({ ...weights, w3: v })}
            />
            <WeightSlider
              label="w₄ Critical facilities"
              value={weights.w4}
              onChange={(v) => setWeights({ ...weights, w4: v })}
            />
            <div className="flex items-center justify-between pt-1">
              <span
                className={`text-[10px] font-mono ${
                  Math.abs(weightSum - 1) < 0.001
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }`}
              >
                Σw = {weightSum.toFixed(2)}{' '}
                {Math.abs(weightSum - 1) < 0.001 ? '(normalized)' : '(renormalized on apply)'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 text-[10px] text-zinc-400"
                onClick={resetWeights}
              >
                <RotateCcw className="h-3 w-3" />
                Reset {`(${DEFAULT_WEIGHTS.w1}/${DEFAULT_WEIGHTS.w2}/${DEFAULT_WEIGHTS.w3}/${DEFAULT_WEIGHTS.w4})`}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-zinc-300">{label}</span>
        <span className="text-[11px] font-mono text-amber-300">
          {value.toFixed(2)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={0}
        max={0.6}
        step={0.01}
        onValueChange={(vals) => onChange(vals[0])}
        className="cursor-pointer"
      />
    </div>
  );
}
