import { p2v } from './coordinates';

export function drawAnnotationsOnCanvas(canvas, viewport, annotations) {
	let ctx = canvas.getContext('2d', { alpha: false });

	let scale = canvas.width / viewport.width;
	ctx.transform(scale, 0, 0, scale, 0, 0);
	ctx.globalCompositeOperation = 'multiply';

	for (let annotation of annotations) {
		let { color } = annotation;
		let position = p2v(annotation.position, viewport);
		ctx.save();
		if (annotation.type === 'highlight') {
			ctx.fillStyle = color + '80';
			for (let rect of position.rects) {
				ctx.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
			}
		}
		else if (annotation.type === 'note') {
			ctx.save();
			let [x, y] = position.rects[0];
			// TODO: Investigate why devicePixelRatio necessary here but not in page.drawNote
			let s = 1 / devicePixelRatio;
			ctx.transform(s, 0, 0, s, x, y);

			ctx.fillStyle = '#000';
			var path = new Path2D('M0,0V12.707L11.293,24H24V0ZM11,22.293,1.707,13H11ZM23,23H12V12H1V1H23Z');
			ctx.fill(path);

			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.moveTo(0.5, 0.5);
			ctx.lineTo(23.5, 0.5);
			ctx.lineTo(23.5, 23.5);
			ctx.lineTo(11.5, 23.5);
			ctx.lineTo(0.5, 12.5);
			ctx.closePath();
			ctx.fill();

			ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
			ctx.beginPath();
			ctx.moveTo(0.5, 12.5);
			ctx.lineTo(11.5, 12.5);
			ctx.lineTo(11.5, 23.5);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		}
		else if (annotation.type === 'image') {
			let rect = position.rects[0];
			ctx.lineWidth = 2;
			ctx.strokeStyle = color;
			ctx.strokeRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
		}
		else if (annotation.type === 'ink') {
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.lineWidth = position.width;
			ctx.beginPath();
			ctx.strokeStyle = color;
			for (let path of position.paths) {
				for (let i = 0; i < path.length - 1; i += 2) {
					let x = path[i];
					let y = path[i + 1];

					if (i === 0) {
						ctx.moveTo(x, y);
					}
					ctx.lineTo(x, y);
				}
			}
			ctx.stroke();
		}
		ctx.restore();
	}
}
