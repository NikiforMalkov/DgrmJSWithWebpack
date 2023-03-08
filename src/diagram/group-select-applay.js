import { CanvasSmbl } from '../infrastructure/canvas-smbl.js';
import { movementApplay, ProcessedSmbl } from '../infrastructure/move-evt-proc.js';
import { placeToCell, pointInCanvas } from '../infrastructure/move-scale-applay.js';
import { arrPop, classAdd, classDel, listen, listenDel, positionSet, svgEl } from '../infrastructure/util.js';
import { PathSmbl } from '../shapes/path-smbl.js';
import { ShapeSmbl } from '../shapes/shape-smbl.js';
import { GroupSettings } from './group-settings.js';
import { canvasSelectionClear, canvasSelectionClearSet, copyAndPast } from './copy-past-applay.js';
import { modalCreate } from '../shapes/modal-create.js';

const highlightSClass = 'highlight-s';
const highlightEClass = 'highlight-e';
const highlightClass = 'highlight';

/** @param {CanvasElement} canvas */
export function groupSelectApplay(canvas) {
	const svg = canvas.ownerSVGElement;
	let timer;
	/** @type {Point} */ let selectStart;
	/** @type {SVGCircleElement} */ let startCircle;
	/** @type {SVGRectElement} */ let selectRect;
	/** @type {Point} */ let selectRectPos;

	/** @param {PointerEvent} evt */
	function onMove(evt) {
		if (evt[ProcessedSmbl] || !selectRect) { reset(); return; }
		evt[ProcessedSmbl] = true;

		if (startCircle) { startCircle.remove(); startCircle = null; }

		// draw rect
		const x = evt.clientX - selectStart.x;
		const y = evt.clientY - selectStart.y;
		selectRect.width.baseVal.value = Math.abs(x);
		selectRect.height.baseVal.value = Math.abs(y);
		if (x < 0) { selectRectPos.x = evt.clientX; }
		if (y < 0) { selectRectPos.y = evt.clientY; }
		selectRect.style.transform = `translate(${selectRectPos.x}px, ${selectRectPos.y}px)`;
	}

	function onUp() {
		if (selectRect) {
			/** @param {Point} point */
			const inRect = point => pointInRect(
				pointInCanvas(canvas[CanvasSmbl].data, selectRectPos.x, selectRectPos.y),
				selectRect.width.baseVal.value / canvas[CanvasSmbl].data.scale,
				selectRect.height.baseVal.value / canvas[CanvasSmbl].data.scale,
				point.x, point.y);

			// select shapes in rect
			groupSelect(
				canvas,
				/** @type {Iterable<ShapeOrPathElement>} */(canvas.children),
				inRect);
		}

		reset();
	}

	function reset() {
		clearTimeout(timer); timer = null;
		startCircle?.remove(); startCircle = null;
		selectRect?.remove(); selectRect = null;

		listenDel(svg, 'pointermove', onMove);
		listenDel(svg, 'wheel', reset);
		listenDel(svg, 'pointerup', onUp);
	}

	listen(svg, 'pointerdown', /** @param {PointerEvent} evt */ evt => {
		if (evt[ProcessedSmbl] || !evt.isPrimary) { reset(); return; }

		listen(svg, 'pointermove', onMove);
		listen(svg, 'wheel', reset, true);
		listen(svg, 'pointerup', onUp, true);

		timer = setTimeout(_ => {
			// if (groupEvtProcDispose) { groupEvtProcDispose(); groupEvtProcDispose = null; }
			canvasSelectionClear(canvas);

			startCircle = svgEl('circle');
			classAdd(startCircle, 'ative-elem');
			startCircle.style.cssText = 'r:10px; fill: rgb(108 187 247 / 51%)';
			positionSet(startCircle, { x: evt.clientX, y: evt.clientY });
			svg.append(startCircle);

			selectStart = { x: evt.clientX, y: evt.clientY };
			selectRectPos = { x: evt.clientX, y: evt.clientY };
			selectRect = svgEl('rect');
			selectRect.style.cssText = 'rx:10px; fill: rgb(108 187 247 / 51%)';
			positionSet(selectRect, selectRectPos);
			svg.append(selectRect);
		}, 500);
	});
}

/**
 * Highlight and procces gropu operations (like move, del, copy)
 * @param {CanvasElement} canvas
 * @param {Iterable<ShapeOrPathElement>} elems
 * @param {{(position:Point):boolean}=} inRect
 */
export function groupSelect(canvas, elems, inRect) {
	/** @param {{position:Point}} data */
	const shapeInRect = data => inRect ? inRect(data.position) : true;

	/** @type {Selected} */
	const selected = {
		shapes: [],
		shapesPaths: [],
		pathEnds: [],
		pathEndsPaths: []
	};

	/**
	 * @param {ShapeOrPathElement} pathEl,  @param {PathEnd} pathEnd, @param {string} highlightClass
	 * @returns {1|2|0}
	 */
	function pathEndInRect(pathEl, pathEnd, highlightClass) {
		if (!pathEnd.shape && shapeInRect(pathEnd.data)) {
			selected.pathEnds.push(pathEnd);
			classAdd(pathEl, highlightClass);
			return 1; // connect to end in rect
		} else if (pathEnd.shape && shapeInRect(pathEnd.shape.shapeEl[ShapeSmbl].data)) {
			return 2; // connect to shape in rect
		}
		return 0; // not in rect
	}

	for (const shapeEl of elems) {
		if (shapeEl[ShapeSmbl]) {
			if (shapeInRect(shapeEl[ShapeSmbl].data)) {
				shapeHighlight(shapeEl);
				selected.shapes.push(shapeEl);
			}
		} else if (shapeEl[PathSmbl]) {
			const isStartIn = pathEndInRect(shapeEl, shapeEl[PathSmbl].data.s, highlightSClass);
			const isEndIn = pathEndInRect(shapeEl, shapeEl[PathSmbl].data.e, highlightEClass);

			if (isStartIn === 1 || isEndIn === 1) {
				selected.pathEndsPaths.push(shapeEl);
			}

			if (isStartIn === 2 || isEndIn === 2) {
				selected.shapesPaths.push(shapeEl);
			}
		}
	}

	groupEvtProc(canvas, selected);
}

/**
 * @param {CanvasElement} canvas
 * @param {Selected} selected
 */
function groupEvtProc(canvas, selected) {
	const svg = canvas.ownerSVGElement;
	let isMove = false;
	let isDownOnSelectedShape = false;

	/** @type {{del():void}} */
	let settingsPnl;
	const pnlDel = () => { settingsPnl?.del(); settingsPnl = null; };

	/** @param {PointerEvent & {target:Node}} evt */
	function down(evt) {
		pnlDel();
		isDownOnSelectedShape =
			selected.shapes?.some(shapeEl => shapeEl.contains(evt.target)) ||
			selected.pathEnds?.some(pathEnd => pathEnd.el.contains(evt.target));

		// down on not selected shape
		if (!isDownOnSelectedShape && evt.target !== svg) {
			dispose();
			return;
		}

		if (isDownOnSelectedShape) {
			evt.stopImmediatePropagation();
		}

		svg.setPointerCapture(evt.pointerId);
		listen(svg, 'pointerup', up, true);
		listen(svg, 'pointermove', move);
	}

	/** @param { {(point:Point):void} } pointMoveFn */
	function drawSelection(pointMoveFn) {
		selected.shapes?.forEach(shapeEl => {
			pointMoveFn(shapeEl[ShapeSmbl].data.position);
			shapeEl[ShapeSmbl].drawPosition();
		});
		selected.pathEnds?.forEach(pathEnd => pointMoveFn(pathEnd.data.position));
		selected.pathEndsPaths?.forEach(path => path[PathSmbl].draw());
	}

	/** @param {PointerEvent} evt */
	function up(evt) {
		if (!isMove) {
			// click on canvas
			if (!isDownOnSelectedShape) { dispose(); return; }

			// click on selected shape - show settings panel
			settingsPnl = modalCreate(evt.clientX - 10, evt.clientY - 10, new GroupSettings(cmd => {
				switch (cmd) {
					case 'del':
						arrPop(selected.shapes, shapeEl => shapeEl[ShapeSmbl].del());
						arrPop(selected.pathEndsPaths, pathEl => pathEl[PathSmbl].del());
						dispose();
						break;
					case 'copy': {
						pnlDel();
						copyPast(canvas, selected);
						dispose();
						break;
					}
				}
			}));
		} else {
			// move end
			drawSelection(point => placeToCell(point, canvas[CanvasSmbl].data.cell));
		}

		dispose(true);
	}

	/** @param {PointerEventFixMovement} evt */
	function move(evt) {
		// move canvas
		if (!isDownOnSelectedShape) { dispose(true); return; }

		// move selected shapes
		isMove = true;
		drawSelection(point => movementApplay(point, canvas[CanvasSmbl].data.scale, evt));
	}

	/** @param {boolean=} saveOnDown */
	function dispose(saveOnDown) {
		listenDel(svg, 'pointerup', up);
		listenDel(svg, 'pointermove', move);
		isMove = false;
		isDownOnSelectedShape = false;

		if (!saveOnDown) {
			listenDel(svg, 'pointerdown', down, true);
			pnlDel();
			arrPop(selected.shapes, shapeEl => classDel(shapeEl, highlightClass));
			arrPop(selected.pathEndsPaths, pathEl => pathUnhighlight(pathEl));
			selected.pathEnds = null;
			selected.shapesPaths = null;
			canvas[CanvasSmbl].selectClear = null;
		}
	}

	svg.addEventListener('pointerdown', down, { passive: true, capture: true });

	canvasSelectionClearSet(canvas, dispose);
}

/** @param {CanvasElement} canvas, @param {Selected} selected */
function copyPast(canvas, selected) {
	/** @type {Set<PathElement>} */
	const fullSelectedPaths = new Set();

	/** @param {PathEnd} pathEnd */
	const pathEndSelected = pathEnd =>
		selected.shapes.includes(pathEnd.shape?.shapeEl) || selected.pathEnds.includes(pathEnd);

	/** @param {PathElement} pathEl */
	function fullSelectedPathAdd(pathEl) {
		if (pathEndSelected(pathEl[PathSmbl].data.s) && pathEndSelected(pathEl[PathSmbl].data.e)) {
			fullSelectedPaths.add(pathEl);
		}
	}

	selected.shapesPaths?.forEach(fullSelectedPathAdd);
	selected.pathEndsPaths?.forEach(fullSelectedPathAdd);

	copyAndPast(canvas, [...selected.shapes, ...fullSelectedPaths]);
}

/** @param {PathElement} pathEl`` */
function pathUnhighlight(pathEl) {
	classDel(pathEl, highlightSClass);
	classDel(pathEl, highlightEClass);
}

/** @param {ShapeElement} shapeEl */
const shapeHighlight = shapeEl => classAdd(shapeEl, highlightClass);

/**
 * @param {Point} rectPosition
 * @param {number} rectWidth, @param {number} rectHeight
 * @param {number} x, @param {number} y
 */
const pointInRect = (rectPosition, rectWidth, rectHeight, x, y) =>
	rectPosition.x <= x && x <= rectPosition.x + rectWidth &&
	rectPosition.y <= y && y <= rectPosition.y + rectHeight;

/**
 * @typedef { {
 * 	shapes:ShapeElement[]
 * 	shapesPaths:PathElement[]
 * 	pathEnds: PathEnd[]
 *	pathEndsPaths: PathElement[]
 * } } Selected
 */
/** @typedef { {x:number, y:number} } Point */
/** @typedef { import('../infrastructure/canvas-smbl.js').CanvasElement } CanvasElement */
/** @typedef { import('../shapes/shape-smbl').ShapeElement } ShapeElement */
/** @typedef { import('../shapes/shape-evt-proc').Shape } Shape */
/** @typedef { import('../shapes/path').Path } Path */
/** @typedef { import('../shapes/path').PathEnd } PathEnd */
/** @typedef { import('../shapes/path-smbl').PathElement } PathElement */
/** @typedef { SVGGraphicsElement & { [ShapeSmbl]?: Shape, [PathSmbl]?:Path }} ShapeOrPathElement */
/** @typedef { import('../infrastructure/move-evt-mobile-fix.js').PointerEventFixMovement} PointerEventFixMovement */
