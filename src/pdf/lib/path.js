// Calculates the Euclidean distance between two points.
function euclideanDistance(p1, p2) {
	const dx = p1[0] - p2[0];
	const dy = p1[1] - p2[1];
	return Math.sqrt(dx * dx + dy * dy);
}

// Filters out points that are too close.
function filterClosePoints(points, minThreshold) {
	const filteredPoints = [points[0], points[1]];
	for (let i = 2; i < points.length; i += 2) {
		const prevPoint = [filteredPoints[filteredPoints.length - 2], filteredPoints[filteredPoints.length - 1]];
		const currentPoint = [points[i], points[i + 1]];
		const distance = euclideanDistance(prevPoint, currentPoint);

		if (distance >= minThreshold) {
			filteredPoints.push(currentPoint[0], currentPoint[1]);
		}
	}
	return filteredPoints;
}

function chaikinSmoothing(points) {
	if (points.length < 4) return points; // Not enough points to smooth
	const smoothedPoints = [points[0], points[1]]; // Keep the first point
	for (let i = 0; i < points.length - 2; i += 2) {
		const x1 = points[i];
		const y1 = points[i + 1];
		const x2 = points[i + 2];
		const y2 = points[i + 3];
		// Calculate 1/4 and 3/4 points
		const Q = [0.75 * x1 + 0.25 * x2, 0.75 * y1 + 0.25 * y2];
		const R = [0.25 * x1 + 0.75 * x2, 0.25 * y1 + 0.75 * y2];
		// Push the points to the new array
		smoothedPoints.push(Q[0], Q[1], R[0], R[1]);
	}
	// Keep the last point
	smoothedPoints.push(points[points.length - 2], points[points.length - 1]);
	return smoothedPoints;
}

export function smoothPath(points) {
	let iterations = 2;
	for (let i = 0; i < iterations; i++) {
		points = chaikinSmoothing(points);
	}
	points = filterClosePoints(points, 1);
	return points;
}

export function applyTransformationMatrixToInkPosition(matrix, position) {
	const { paths, width } = position;
	const a = matrix[0], b = matrix[1], c = matrix[2], d = matrix[3], e = matrix[4], f = matrix[5];
	const transformedPaths = paths.map(path => {
		const transformedPath = [];
		for (let i = 0; i < path.length; i += 2) {
			const x = path[i];
			const y = path[i + 1];
			const newX = a * x + c * y + e;
			const newY = b * x + d * y + f;
			transformedPath.push(newX, newY);
		}
		return transformedPath;
	});
	let scaleFactor = Math.sqrt(Math.abs(a * d - b * c));
	const transformedWidth = width * scaleFactor;
	return {
		...position,
		paths: transformedPaths,
		width: transformedWidth
	};
}

function removeIntersectingPoints(circleCenterX, circleCenterY, circleWidth, position) {
	const isPointInsideCircle = (x, y, centerX, centerY, radius) => {
		const dx = x - centerX;
		const dy = y - centerY;
		const distance = Math.sqrt(dx * dx + dy * dy);
		return distance <= radius;
	};

	const newPathList = [];
	let currentPath = [];

	position.paths.forEach(path => {
		for (let i = 0; i < path.length; i += 2) {
			const x = path[i];
			const y = path[i + 1];

			if (!isPointInsideCircle(x, y, circleCenterX, circleCenterY, circleWidth / 2)) {
				currentPath.push(x, y);
			} else {
				if (currentPath.length > 0) {
					newPathList.push(currentPath);
					currentPath = [];
				}
			}
		}

		if (currentPath.length > 0) {
			newPathList.push(currentPath);
			currentPath = [];
		}
	});

	position = { ...position, paths: newPathList };
	return position;
}

export function eraseInk(circleCenterX, circleCenterY, circleWidth, annotations) {
	const modifiedAnnotations = [];

	annotations.forEach(annotation => {
		const originalTotalPoints = annotation.position.paths.reduce((total, path) => total + path.length, 0);
		let { position } = annotation;
		position = removeIntersectingPoints(circleCenterX, circleCenterY, circleWidth, position);
		const newTotalPoints = position.paths.reduce((total, path) => total + path.length, 0);

		if (newTotalPoints !== originalTotalPoints) {
			modifiedAnnotations.push({ ...annotation, position, image: undefined });
		}
	});

	return modifiedAnnotations;
}
