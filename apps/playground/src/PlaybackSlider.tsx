import { Slider } from '@rivetjs/ui/slider';
import { Label } from '@rivetjs/ui/label';
import { Description } from '@rivetjs/ui/description';

interface PlaybackSliderProps {
  id: string;
  label: string;
  position: number;
  total: number;
  onSeek: (position: number) => void;
}

export function PlaybackSlider(props: PlaybackSliderProps) {
  const percentage = () => (props.total ? Math.round((props.position / props.total) * 100) : 0);
  return (
    <div class="playback-scrubber">
      <Slider<number>
        id={props.id}
        value={() => props.position}
        minValue={0}
        maxValue={Math.max(1, props.total)}
        step={1}
        snap="drag"
        isDisabled={props.total === 0}
        onChange={(value) => props.onSeek(value)}
        aria-describedby={`${props.id}-help`}
      >
        <Label>{props.label}</Label>
        <Slider.Output>
          <span>{percentage()}%</span>
        </Slider.Output>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
      <Description id={`${props.id}-help`}>
        Drag to explore the stream. Play continues from here.
      </Description>
    </div>
  );
}
