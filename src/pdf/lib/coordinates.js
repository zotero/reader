export function p2v(position, viewport, pageIndex = null) {
	if (position.rects) {
		if (pageIndex === position.pageIndex + 1 && position.nextPageRects) {
			return {
				pageIndex: position.pageIndex,
				nextPageRects: position.nextPageRects.map((rect) => {
					let [x1, y2] = viewport.convertToViewportPoint(rect[0], rect[1]);
					let [x2, y1] = viewport.convertToViewportPoint(rect[2], rect[3]);
					return [
						Math.min(x1, x2),
						Math.min(y1, y2),
						Math.max(x1, x2),
						Math.max(y1, y2)
					];
				})
			};
		}
		else {
			let position2 = {
				pageIndex: position.pageIndex,
				rects: position.rects.map((rect) => {
					let [x1, y2] = viewport.convertToViewportPoint(rect[0], rect[1]);
					let [x2, y1] = viewport.convertToViewportPoint(rect[2], rect[3]);
					return [
						Math.min(x1, x2),
						Math.min(y1, y2),
						Math.max(x1, x2),
						Math.max(y1, y2)
					];
				})
			};

			// For text annotations
			if (position.fontSize) {
				position2.fontSize = position.fontSize * viewport.scale;
			}
			if (position.rotation) {
				position2.rotation = position.rotation;
			}
			return position2;
		}
	}
	else if (position.paths) {
		return {
			pageIndex: position.pageIndex,
			width: position.width * viewport.scale,
			paths: position.paths.map((path) => {
				let vpath = [];
				for (let i = 0; i < path.length - 1; i += 2) {
					let x = path[i];
					let y = path[i + 1];
					vpath.push(...viewport.convertToViewportPoint(x, y));
				}
				return vpath;
			})
		};
	}
}

export function v2p(position, viewport) {
	return {
		pageIndex: position.pageIndex,
		rects: position.rects.map((rect) => {
			let [x1, y2] = viewport.convertToPdfPoint(rect[0], rect[1]);
			let [x2, y1] = viewport.convertToPdfPoint(rect[2], rect[3]);
			return [
				Math.min(x1, x2),
				Math.min(y1, y2),
				Math.max(x1, x2),
				Math.max(y1, y2)
			];
		})
	};
}

export function wx(rect) {
	return rect[2] - rect[0];
}

export function hy(rect) {
	return rect[3] - rect[1];
}
