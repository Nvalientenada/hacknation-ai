type Props = {
  value: { ports: boolean; piracy: boolean; bathy: boolean; weather: boolean };
  onChange: (v: Props["value"]) => void;
};

export default function LayerToggles({ value, onChange }: Props) {
  const flip = (k: keyof Props["value"]) => onChange({ ...value, [k]: !value[k] });

  return (
    <div className="glass p-3 rounded-xl text-sm flex flex-wrap items-center gap-3">
      <span className="text-white/70 mr-2">Layers:</span>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.ports} onChange={() => flip('ports')} /> Ports
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.piracy} onChange={() => flip('piracy')} /> Piracy
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.bathy} onChange={() => flip('bathy')} /> Bathymetry
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.weather} onChange={() => flip('weather')} /> Weather
      </label>
    </div>
  );
}
