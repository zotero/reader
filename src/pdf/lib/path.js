
// Calculates the Euclidean distance between two points.
function euclideanDistance(p1, p2) {
	const dx = p1[0] - p2[0];
	const dy = p1[1] - p2[1];
	return Math.sqrt(dx * dx + dy * dy);
}

// Returns a point between two given points with a specified ratio.
// Rounds the coordinates to a maximum of 3 decimal places.
function interpolatePoint(p1, p2, ratio) {
	return [
		parseFloat((p1[0] + (p2[0] - p1[0]) * ratio).toFixed(3)),
		parseFloat((p1[1] + (p2[1] - p1[1]) * ratio).toFixed(3))
	];
}

// Filters out points that are too close.
export function filterClosePoints(points, minThreshold) {
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

// Inserts additional points if the distance between two consecutive points
// is larger than the maxThreshold value.
export function insertMissingPoints(points, maxThreshold) {
	const processedPoints = [points[0], points[1]];

	for (let i = 2; i < points.length; i += 2) {
		const prevPoint = [processedPoints[processedPoints.length - 2], processedPoints[processedPoints.length - 1]];
		const currentPoint = [points[i], points[i + 1]];
		const distance = euclideanDistance(prevPoint, currentPoint);

		if (distance > maxThreshold) {
			const numPointsToInsert = Math.ceil(distance / maxThreshold) - 1;
			for (let j = 0; j < numPointsToInsert; j++) {
				const ratio = (j + 1) / (numPointsToInsert + 1);
				const interpolatedPoint = interpolatePoint(prevPoint, currentPoint, ratio);
				processedPoints.push(interpolatedPoint[0], interpolatedPoint[1]);
			}
		}
		processedPoints.push(currentPoint[0], currentPoint[1]);
	}

	return processedPoints;
}

// Smoothens path edges using the Catmull-Rom Spline technique.
export function catmullRomSpline(points, segments) {
	function calculatePoint(p0, p1, p2, p3, t) {
		const t2 = t * t;
		const t3 = t2 * t;

		const x = 0.5 * ((2 * p1[0]) +
			(-p0[0] + p2[0]) * t +
			(2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
			(-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
		const y = 0.5 * ((2 * p1[1]) +
			(-p0[1] + p2[1]) * t +
			(2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
			(-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);

		return [x, y];
	}

	const smoothedPoints = [];
	const numPoints = points.length / 2;

	for (let i = 0; i < numPoints - 1; i++) {
		const p0 = (i === 0) ? [points[0], points[1]] : [points[(i - 1) * 2], points[(i - 1) * 2 + 1]];
		const p1 = [points[i * 2], points[i * 2 + 1]];
		const p2 = [points[(i + 1) * 2], points[(i + 1) * 2 + 1]];
		const p3 = (i === numPoints - 2) ? [points[numPoints * 2 - 2], points[numPoints * 2 - 1]] : [points[(i + 2) * 2], points[(i + 2) * 2 + 1]];

		for (let j = 0; j < segments; j++) {
			const t = j / segments;
			const point = calculatePoint(p0, p1, p2, p3, t);
			smoothedPoints.push(point[0], point[1]);
		}
	}

	// Add the last point
	smoothedPoints.push(points[numPoints * 2 - 2], points[numPoints * 2 - 1]);

	return smoothedPoints;
}

export function addPointToPath(path, newPoint) {
	const minThreshold = 5;
	const maxThreshold = 20;
	const segments = 10;
	// Insert missing points
	const interpolatedPath = insertMissingPoints(path, maxThreshold);
	// Smooth the path using Catmull-Rom Spline
	const smoothedPath = catmullRomSpline(interpolatedPath, segments);
	// Filter close points
	const filteredPath = filterClosePoints(smoothedPath, minThreshold);
	// Add the new point to the path
	filteredPath.push(newPoint[0], newPoint[1]);
	return filteredPath;
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
			modifiedAnnotations.push({ ...annotation, position });
		}
	});

	return modifiedAnnotations;
}
