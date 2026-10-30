/*! Motion v14.7.1 | MIT | https://github.com/motiondivision/motion | vendored for the served Remote (ADR-0031). */
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/array.mjs
function e(e, t) {
	e.indexOf(t) === -1 && e.push(t);
}
function t(e, t) {
	let n = e.indexOf(t);
	n > -1 && e.splice(n, 1);
}
//#endregion
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/clamp.mjs
var n = (e, t, n) => n > t ? t : n < e ? e : n;
//#endregion
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/format-error-message.mjs
function r(e, t) {
	return t ? `${e}. For more information and steps for solving, visit https://motion.dev/troubleshooting/${t}` : e;
}
//#endregion
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/errors.mjs
var i = () => {}, a = () => {};
typeof process < "u" && process.env.NODE_ENV !== "production" && (i = (e, t, n) => {
	!e && typeof console < "u" && console.warn(r(t, n));
}, a = (e, t, n) => {
	if (!e) throw Error(r(t, n));
});
//#endregion
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/global-config.mjs
var o = {}, s = (e) => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(e), c = (e) => typeof e == "object" && !!e, l = (e) => /^0[^.\s]+$/u.test(e);
//#endregion
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/memo.mjs
/*#__NO_SIDE_EFFECTS__*/
function u(e) {
	let t;
	return () => (t === void 0 && (t = e()), t);
}
//#endregion
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/noop.mjs
var d = /* @__NO_SIDE_EFFECTS__ */ (e) => e, f = (...e) => e.reduce((e, t) => (n) => t(e(n))), p = /* @__NO_SIDE_EFFECTS__ */ (e, t, n) => {
	let r = t - e;
	return r ? (n - e) / r : 1;
}, m = class {
	constructor() {
		this.subscriptions = [];
	}
	add(t) {
		return e(this.subscriptions, t), () => this.remove(t);
	}
	remove(e) {
		t(this.subscriptions, e);
	}
	notify(e, t, n) {
		let r = this.subscriptions.length;
		if (r) {
			if (r === 1) this.subscriptions[0](e, t, n);
			else for (let i = 0; i < r; i++) {
				let r = this.subscriptions[i];
				r && r(e, t, n);
			}
		}
	}
	getSize() {
		return this.subscriptions.length;
	}
	clear() {
		this.subscriptions.length = 0;
	}
}, h = /* @__NO_SIDE_EFFECTS__ */ (e) => e * 1e3, g = /* @__NO_SIDE_EFFECTS__ */ (e) => e / 1e3, _ = /* @__NO_SIDE_EFFECTS__ */ (e, t) => t ? 1e3 / t * e : 0, v = /* @__PURE__ */ new Set();
function y(e, t, n) {
	e || v.has(t) || (console.warn(r(t, n)), v.add(t));
}
//#endregion
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/wrap.mjs
var b = (e, t, n) => {
	let r = t - e;
	return ((n - e) % r + r) % r + e;
}, x = (e, t, n) => e * (3 * (1 - e) * ((1 - e) * t + e * n) + e * e);
/*#__NO_SIDE_EFFECTS__*/
function S(e, t, n, r) {
	return e === t && n === r ? d : (i) => {
		let a = 0, o = 1, s = i;
		for (let t = 0;; t++) {
			s >= a && s <= o || (s = (a + o) / 2);
			let r = x(s, e, n) - i;
			if (r * r < 1e-28 || t === 40) break;
			r > 0 ? o = s : a = s, s -= r * 1e-7 / (x(s + 1e-7, e, n) - i - r);
		}
		return x(s, t, r);
	};
}
//#endregion
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/easing/modifiers/mirror.mjs
var C = /* @__NO_SIDE_EFFECTS__ */ (e) => (t) => t <= .5 ? e(2 * t) / 2 : (2 - e(2 * (1 - t))) / 2, w = /* @__NO_SIDE_EFFECTS__ */ (e) => (t) => 1 - e(1 - t), T = /*@__PURE__*/ S(.33, 1.53, .69, .99), E = /*@__PURE__*/ w(T), ee = /*@__PURE__*/ C(E), D = (e) => e >= 1 ? 1 : (e *= 2) < 1 ? .5 * E(e) : .5 * (2 - 2 ** (-10 * (e - 1))), O = (e) => 1 - Math.sin(Math.acos(e)), te = /* @__PURE__ */ w(O), k = /* @__PURE__ */ C(O), ne = /*@__PURE__*/ S(.42, 0, 1, 1), re = /*@__PURE__*/ S(0, 0, .58, 1), ie = /*@__PURE__*/ S(.42, 0, .58, 1), ae = /* @__NO_SIDE_EFFECTS__ */ (e) => Array.isArray(e) && typeof e[0] != "number";
//#endregion
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/easing/utils/get-easing-for-segment.mjs
/*#__NO_SIDE_EFFECTS__*/
function oe(e, t) {
	return /* @__PURE__ */ ae(e) ? e[b(0, e.length, t)] : e;
}
//#endregion
//#region node_modules/.pnpm/motion-utils@14.7.0/node_modules/motion-utils/dist/es/easing/utils/is-bezier-definition.mjs
var se = /* @__NO_SIDE_EFFECTS__ */ (e) => Array.isArray(e) && typeof e[0] == "number", ce = {
	linear: d,
	easeIn: ne,
	easeInOut: ie,
	easeOut: re,
	circIn: O,
	circInOut: k,
	circOut: te,
	backIn: E,
	backInOut: ee,
	backOut: T,
	anticipate: D
}, le = (e) => typeof e == "string", ue = (e) => {
	if (/* @__PURE__ */ se(e)) {
		typeof process < "u" && process.env.NODE_ENV !== "production" && a(e.length === 4, "Cubic bezier arrays must contain four numerical values.", "cubic-bezier-length");
		let [t, n, r, i] = e;
		return /* @__PURE__ */ S(t, n, r, i);
	}
	return le(e) ? (typeof process < "u" && process.env.NODE_ENV !== "production" && a(ce[e] !== void 0, `Invalid easing type '${e}'`, "invalid-easing-type"), ce[e]) : e;
}, A = {
	delta: 0,
	timestamp: 0,
	isProcessing: !1
}, de;
function fe() {
	de = void 0;
}
var j = {
	now: () => (de === void 0 && j.set(A.isProcessing || o.useManualTiming ? A.timestamp : performance.now()), de),
	set: (e) => {
		de = e, queueMicrotask(fe);
	}
}, M = (e) => Math.round(e * 1e5) / 1e5, pe = /*@__PURE__*/ ((e) => (t) => typeof t == "string" && t.startsWith(e))("var(--"), me = (e) => pe(e) ? he.test(e.split("/*")[0].trim()) : !1, he = /var\(--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)$/iu;
function ge(e) {
	return typeof e == "string" && e.split("/*")[0].includes("var(--");
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/value/types/numbers/index.mjs
var N = {
	test: (e) => typeof e == "number",
	parse: parseFloat,
	transform: (e) => e
}, _e = {
	...N,
	transform: (e) => n(0, 1, e)
}, ve = {
	...N,
	default: 1
}, ye = /-?(?:\d+(?:\.\d+)?|\.\d+)/gu;
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/value/types/utils/is-nullish.mjs
function be(e) {
	return e == null;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/value/types/utils/single-color-regex.mjs
var xe = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))$/iu, Se = (e, t) => (n) => !!(typeof n == "string" && xe.test(n) && n.startsWith(e) || t && !be(n) && Object.prototype.hasOwnProperty.call(n, t)), Ce = (e, t, n) => (r) => {
	if (typeof r != "string") return r;
	let [i, a, o, s] = r.match(ye);
	return {
		[e]: parseFloat(i),
		[t]: parseFloat(a),
		[n]: parseFloat(o),
		alpha: s === void 0 ? 1 : parseFloat(s)
	};
}, we = (e) => n(0, 255, e), Te = {
	...N,
	transform: (e) => Math.round(we(e))
}, P = {
	test: /*@__PURE__*/ Se("rgb", "red"),
	parse: /*@__PURE__*/ Ce("red", "green", "blue"),
	transform: ({ red: e, green: t, blue: n, alpha: r = 1 }) => "rgba(" + Te.transform(e) + ", " + Te.transform(t) + ", " + Te.transform(n) + ", " + M(_e.transform(r)) + ")"
}, Ee = (e, t, n) => {
	let r = e.substring(1 + t * n, 1 + (t + 1) * n);
	return n > 1 ? r : r + r;
};
function De(e) {
	let t = e.length > 5 ? 2 : 1, n = Ee(e, 3, t);
	return {
		red: parseInt(Ee(e, 0, t), 16),
		green: parseInt(Ee(e, 1, t), 16),
		blue: parseInt(Ee(e, 2, t), 16),
		alpha: n ? parseInt(n, 16) / 255 : 1
	};
}
var Oe = {
	test: /*@__PURE__*/ Se("#"),
	parse: De,
	transform: P.transform
}, ke = /* @__NO_SIDE_EFFECTS__ */ (e) => ({
	test: (t) => typeof t == "string" && t.endsWith(e) && t.split(" ").length === 1,
	parse: parseFloat,
	transform: (t) => `${t}${e}`
}), F = /*@__PURE__*/ ke("deg"), I = /*@__PURE__*/ ke("%"), L = /*@__PURE__*/ ke("px"), Ae = /*@__PURE__*/ ke("vh"), je = /*@__PURE__*/ ke("vw"), Me = {
	...I,
	parse: (e) => I.parse(e) / 100,
	transform: (e) => I.transform(e * 100)
}, R = {
	test: /*@__PURE__*/ Se("hsl", "hue"),
	parse: /*@__PURE__*/ Ce("hue", "saturation", "lightness"),
	transform: ({ hue: e, saturation: t, lightness: n, alpha: r = 1 }) => "hsla(" + Math.round(e) + ", " + I.transform(M(t)) + ", " + I.transform(M(n)) + ", " + M(_e.transform(r)) + ")"
}, z = {
	test: (e) => P.test(e) || Oe.test(e) || R.test(e),
	parse: (e) => P.test(e) ? P.parse(e) : R.test(e) ? R.parse(e) : Oe.parse(e),
	transform: (e) => typeof e == "string" ? e : e.hasOwnProperty("red") ? P.transform(e) : R.transform(e),
	getAnimatableNone: (e) => {
		let t = z.parse(e);
		return t.alpha = 0, z.transform(t);
	}
}, Ne = /(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))/giu, Pe = /*@__PURE__*/ new RegExp(ye.source), Fe = /*@__PURE__*/ new RegExp(Ne.source, "i");
function Ie(e) {
	return isNaN(e) && typeof e == "string" && (Pe.test(e) || Fe.test(e));
}
var Le = "number", Re = "color", ze = "var", Be = "var(", Ve = "${}", He = /var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)|#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)|-?(?:\d+(?:\.\d+)?|\.\d+)(?![a-z]*\()/giu;
function Ue(e) {
	let t = e.toString();
	return Pe.test(t) || Fe.test(t);
}
function B(e) {
	let t = e.toString(), n = [], r = {
		color: [],
		number: [],
		var: []
	}, i = [], a = 0;
	return {
		values: n,
		split: t.replace(He, (e) => (z.test(e) ? (r.color.push(a), i.push(Re), n.push(z.parse(e))) : e.startsWith(Be) ? (r.var.push(a), i.push(ze), n.push(e)) : (r.number.push(a), i.push(Le), n.push(parseFloat(e))), ++a, Ve)).split(Ve),
		indexes: r,
		types: i
	};
}
function We(e) {
	return B(e).values;
}
function Ge({ split: e, types: t }) {
	let n = e.length;
	return (r) => {
		let i = "";
		for (let a = 0; a < n; a++) if (i += e[a], r[a] !== void 0) {
			let e = t[a];
			i += e === Le ? M(r[a]) : e === Re ? z.transform(r[a]) : r[a];
		}
		return i;
	};
}
function Ke(e) {
	return Ge(B(e));
}
var qe = (e) => typeof e == "number" ? 0 : z.test(e) ? z.getAnimatableNone(e) : e, Je = (e, t) => typeof e == "number" ? t?.trim().endsWith("/") ? e : 0 : qe(e);
function Ye(e) {
	let t = B(e);
	return Ge(t)(t.values.map((e, n) => Je(e, t.split[n])));
}
var V = {
	test: Ie,
	parse: We,
	createTransformer: Ke,
	getAnimatableNone: Ye
};
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/value/types/color/hsla-to-rgba.mjs
function Xe(e, t, n) {
	return n < 0 && (n += 1), n > 1 && --n, n < 1 / 6 ? e + (t - e) * 6 * n : n < 1 / 2 ? t : n < 2 / 3 ? e + (t - e) * (2 / 3 - n) * 6 : e;
}
function Ze({ hue: e, saturation: t, lightness: n, alpha: r }) {
	e /= 360, t /= 100, n /= 100;
	let i = 0, a = 0, o = 0;
	if (!t) i = a = o = n;
	else {
		let r = n < .5 ? n * (1 + t) : n + t - n * t, s = 2 * n - r;
		i = Xe(s, r, e + 1 / 3), a = Xe(s, r, e), o = Xe(s, r, e - 1 / 3);
	}
	return {
		red: Math.round(i * 255),
		green: Math.round(a * 255),
		blue: Math.round(o * 255),
		alpha: r
	};
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/utils/mix/immediate.mjs
function Qe(e, t) {
	return (n) => n > 0 ? t : e;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/utils/mix/number.mjs
var H = (e, t, n) => e + (t - e) * n, $e = (e, t, n) => {
	let r = e * e, i = n * (t * t - r) + r;
	return i < 0 ? 0 : Math.sqrt(i);
}, et = [
	Oe,
	P,
	R
], tt = (e) => et.find((t) => t.test(e));
function nt(e) {
	let t = tt(e);
	if (!t) return process.env.NODE_ENV !== "production" && i(!1, `'${e}' is not an animatable color. Use the equivalent color code instead.`, "color-not-animatable"), !1;
	let n = t.parse(e);
	return t === R && (n = Ze(n)), n;
}
var rt = (e, t) => {
	let n = nt(e), r = nt(t);
	if (!n || !r) return Qe(e, t);
	let i = { ...n };
	return (e) => (i.red = $e(n.red, r.red, e), i.green = $e(n.green, r.green, e), i.blue = $e(n.blue, r.blue, e), i.alpha = H(n.alpha, r.alpha, e), P.transform(i));
}, it = /* @__PURE__ */ new Set(["none", "hidden"]);
function at(e, t) {
	return it.has(e) ? (n) => n <= 0 ? e : t : (n) => n >= 1 ? t : e;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/utils/mix/complex.mjs
function ot(e, t) {
	return (n) => H(e, t, n);
}
function st(e) {
	return typeof e == "number" ? ot : typeof e == "string" ? me(e) ? Qe : z.test(e) ? rt : dt : Array.isArray(e) ? ct : typeof e == "object" ? z.test(e) ? rt : lt : Qe;
}
function ct(e, t) {
	let n = [...e], r = n.length, i = e.map((e, n) => st(e)(e, t[n]));
	return (e) => {
		for (let t = 0; t < r; t++) n[t] = i[t](e);
		return n;
	};
}
function lt(e, t) {
	let n = {
		...e,
		...t
	}, r = {};
	for (let i in n) e[i] !== void 0 && t[i] !== void 0 && (r[i] = st(e[i])(e[i], t[i]));
	return (e) => {
		for (let t in r) n[t] = r[t](e);
		return n;
	};
}
function ut(e, t) {
	let n = [], r = {
		color: 0,
		var: 0,
		number: 0
	};
	for (let i = 0; i < t.values.length; i++) {
		let a = t.types[i], o = e.indexes[a][r[a]], s = e.values[o] ?? 0;
		n[i] = s, r[a]++;
	}
	return n;
}
var dt = (e, t) => {
	let n = B(e), r = B(t);
	return n.indexes.var.length === r.indexes.var.length && n.indexes.color.length === r.indexes.color.length && n.indexes.number.length >= r.indexes.number.length ? it.has(e) && !r.values.length || it.has(t) && !n.values.length ? at(e, t) : f(ct(ut(n, r), r.values), Ge(r)) : (process.env.NODE_ENV !== "production" && i(!0, `Complex values '${e}' and '${t}' too different to mix. Ensure all colors are of the same type, and that each contains the same quantity of number and color values. Falling back to instant transition.`, "complex-values-different"), Qe(e, t));
}, ft = /^(-?(?:\d+(?:\.\d*)?|\.\d+))([a-z%]*)$/iu;
function pt(e, t) {
	let n = ft.exec(e);
	if (!n) return;
	let r = ft.exec(t);
	if (!r || n[2] !== r[2]) return;
	let i = n[2], a = parseFloat(n[1]), o = parseFloat(r[1]);
	return (e) => M(H(a, o, e)) + i;
}
function mt(e, t, n) {
	if (typeof e == "number" && typeof t == "number" && typeof n == "number") return H(e, t, n);
	if (typeof e == "string" && typeof t == "string") {
		let n = pt(e, t);
		if (n) return n;
	}
	return st(e)(e, t);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/frameloop/order.mjs
var ht = [
	"setup",
	"read",
	"resolveKeyframes",
	"preUpdate",
	"update",
	"preRender",
	"render",
	"postRender"
];
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/frameloop/render-step.mjs
function gt(e) {
	let t = /* @__PURE__ */ new Set(), n = /* @__PURE__ */ new Set(), r = !1, i = !1, a, o = /* @__PURE__ */ new Set(), s = {
		delta: 0,
		timestamp: 0,
		isProcessing: !1
	};
	function c(t) {
		o.has(t) && (n.add(t), e()), (a = t)(s);
	}
	let l = {
		schedule: (e, i = !1, s = !1) => {
			let c = s && r, l = c ? t : n;
			return i && o.add(e), c && e !== a && l.delete(e), l.add(e), e;
		},
		cancel: (e) => {
			n.delete(e), o.delete(e);
		},
		process: (e) => {
			if (s = e, r) {
				i = !0;
				return;
			}
			r = !0;
			let o = t;
			t = n, n = o, t.forEach(c), t.clear(), a = void 0, r = !1, i && (i = !1, l.process(e));
		}
	};
	return l;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/frameloop/batcher.mjs
var _t = 40;
function vt(e, t, n = {
	delta: 0,
	timestamp: 0,
	isProcessing: !1
}) {
	let r = !1, i = !0, a = () => r = !0, s = ht.reduce((e, t) => (e[t] = gt(a), e), {}), { setup: c, read: l, resolveKeyframes: u, preUpdate: d, update: f, preRender: p, render: m, postRender: h } = s, g = () => {
		let a = o.useManualTiming, s = a ? n.timestamp : performance.now();
		r = !1, a || (n.delta = i ? 1e3 / 60 : Math.max(Math.min(s - n.timestamp, _t), 1)), n.timestamp = s, n.isProcessing = !0, c.process(n), l.process(n), u.process(n), d.process(n), f.process(n), p.process(n), m.process(n), h.process(n), n.isProcessing = !1, r && t && (i = !1, e(g));
	}, _ = () => {
		r = !0, i = !0, n.isProcessing || e(g);
	};
	return {
		schedule: ht.reduce((e, t) => {
			let n = s[t];
			return e[t] = (e, t = !1, i = !1) => (r || _(), n.schedule(e, t, i)), e;
		}, {}),
		cancel: (e) => {
			for (let t = 0; t < ht.length; t++) s[ht[t]].cancel(e);
		},
		state: n,
		steps: s
	};
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/frameloop/frame.mjs
var { schedule: U, cancel: yt, steps: bt } = /* @__PURE__ */ vt(typeof requestAnimationFrame < "u" ? requestAnimationFrame : d, !0, A), xt = (e) => {
	let t = ({ timestamp: t }) => e(t);
	return {
		start: (e = !0) => U.update(t, e),
		stop: () => yt(t),
		now: () => A.isProcessing ? A.timestamp : j.now()
	};
}, St = (e, t, n = 10) => {
	let r = "", i = Math.max(Math.round(t / n), 2);
	for (let t = 0; t < i; t++) r += Math.round(e(t / (i - 1)) * 1e4) / 1e4 + ", ";
	return `linear(${r.substring(0, r.length - 2)})`;
}, Ct = 2e4;
function wt(e, t = 50, n = Ct, r) {
	let i = 0, a = e.next(i);
	for (r?.push(a.value); !a.done && i < n;) i += t, a = e.next(i), r?.push(a.value);
	return i >= n ? Infinity : i;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/generators/utils/create-generator-easing.mjs
function Tt(e, t = 100, n) {
	let { keyframes: r, velocity: i } = e, a = r && r[r.length - 1] - r[0], o = n({
		...e,
		velocity: i && a ? i * t / a : i,
		keyframes: [0, t]
	}), s = Math.min(wt(o), Ct);
	return {
		type: "keyframes",
		ease: (e) => o.next(s * e).value / t,
		duration: /* @__PURE__ */ g(s)
	};
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/generators/spring.mjs
var Et = 100, Dt = 10, Ot = 1, kt = 800, At = .3, jt = .3, Mt = .01, Nt = 2, Pt = .005, Ft = .5, It = .01, Lt = 10, Rt = .05, zt = (e) => e < 0 ? 1 / Math.max(1 + e, Rt) : Math.max(1 - e, Rt);
function Bt(e, t) {
	if (!(e > 1)) return 1;
	let n = Math.sqrt(e * e - 1), r = e - n, i = e + n, a = 2 * n * Math.exp(-t) * (1 + t);
	return Ut((e) => i * Math.exp(-r * e) - r * Math.exp(-i * e) - a, (e) => Math.exp(-i * e) - Math.exp(-r * e), t) / t;
}
function Vt(e, t) {
	return e * Math.sqrt(1 - t * t);
}
var Ht = 12;
function Ut(e, t, n) {
	let r = n;
	for (let n = 1; n < Ht; n++) r -= e(r) / t(r);
	return r;
}
var Wt = .001;
function Gt({ duration: e = kt, bounce: t = At }) {
	let r, a;
	process.env.NODE_ENV !== "production" && i(e <= /* @__PURE__ */ h(Lt), "Spring duration must be 10 seconds or less", "spring-duration-limit");
	let o = zt(t);
	e = n(It, Lt, /* @__PURE__ */ g(e)), o < 1 ? (r = (t) => {
		let n = t * o, r = n * e, i = Vt(t, o), a = Math.exp(-r);
		return Wt - n / i * a;
	}, a = (t) => {
		let n = t * o * e, i = o * o * t * t * e, a = Math.exp(-n), s = Vt(t * t, o);
		return (-r(t) + Wt > 0 ? -1 : 1) * -i * a / s;
	}) : (r = (t) => -.001 + Math.exp(-t * e) * (t * e + 1), a = (t) => Math.exp(-t * e) * (-t * (e * e)));
	let s = 5 / e, c = Ut(r, a, s), l = c * Bt(o, c * e), u = l * l;
	return {
		stiffness: u,
		damping: o * 2 * Math.sqrt(u),
		duration: /* @__PURE__ */ h(e)
	};
}
var Kt = (e, t) => (t ? e >= 0 : e > 0) && e < Infinity;
function qt(e, t) {
	if (Kt(e, t)) return e;
	process.env.NODE_ENV !== "production" && i(e === void 0, "Spring stiffness and mass must be positive, damping 0 or greater", "spring-invalid-physics");
}
function Jt(e) {
	let t = qt(e.stiffness), n = qt(e.damping, !0), r = qt(e.mass), i = {
		...e,
		stiffness: t ?? Et,
		damping: n ?? Dt,
		mass: r ?? Ot,
		isResolvedFromDuration: !1,
		isTimeDefined: (t ?? n ?? r) === void 0 && (e.duration !== void 0 || e.bounce !== void 0)
	};
	if (i.isTimeDefined) {
		if (e.visualDuration) {
			let t = zt(e.bounce || 0), n = 2 * Math.PI / (e.visualDuration * 1.2) * Bt(t, 2 * Math.PI / 1.2);
			i.stiffness = n * n, i.damping = 2 * t * Math.sqrt(i.stiffness);
		} else Object.assign(i, Gt(i)), i.isResolvedFromDuration = !0;
		(!Kt(i.stiffness) || !Kt(i.damping, !0)) && (i.stiffness = Et, i.damping = Dt);
	}
	return i;
}
function Yt(e = jt, t = At) {
	let n = typeof e == "object" ? e : {
		visualDuration: e,
		keyframes: [0, 1],
		bounce: t
	}, r = n.keyframes[0], i = n.keyframes[n.keyframes.length - 1], a = {
		done: !1,
		value: r
	}, { stiffness: o, damping: s, mass: c, duration: l, isResolvedFromDuration: u, isTimeDefined: d } = Jt({ ...n }), f = (e) => d ? 0 : -/* @__PURE__ */ g(e), p = s / (2 * Math.sqrt(o * c)), m = /* @__PURE__ */ g(Math.sqrt(o / c)), _ = p * m, v = {
		target: i,
		delta: i - r,
		velocity: f(n.velocity || 0) || 0,
		restSpeed: 0,
		restDelta: 0
	}, y = () => {
		let e = Math.abs(v.delta) < 5;
		v.restSpeed = n.restSpeed || (e ? Mt : Nt), v.restDelta = n.restDelta || (e ? Pt : Ft);
	};
	y();
	let b, x, S;
	if (p < 1) {
		let e = Vt(m, p), t = {
			A: 0,
			sinC: 0,
			cosC: 0,
			t: -1,
			env: 0,
			sin: 0,
			cos: 0
		};
		S = () => {
			t.A = (v.velocity + _ * v.delta) / e, t.sinC = _ * t.A + v.delta * e, t.cosC = _ * v.delta - t.A * e;
		};
		let n = (n) => {
			n !== t.t && (t.t = n, t.env = Math.exp(-_ * n), t.sin = Math.sin(e * n), t.cos = Math.cos(e * n));
		};
		b = (e) => (n(e), v.target - t.env * (t.A * t.sin + v.delta * t.cos)), x = (e) => (n(e), t.env * (t.sinC * t.sin + t.cosC * t.cos));
	} else if (p === 1) {
		b = (e) => v.target - Math.exp(-m * e) * (v.delta + (v.velocity + m * v.delta) * e);
		let e = { C: 0 };
		S = () => {
			e.C = v.velocity + m * v.delta;
		}, x = (t) => Math.exp(-m * t) * (m * e.C * t - v.velocity);
	} else {
		let e = m * Math.sqrt(p * p - 1), t = _ - e, n = _ + e, r = e < 1 || d ? Infinity : 300 / e, i = (e, t) => Math.exp(t > r ? (_ - e) * r - _ * t : -e * t), a = {
			S: 0,
			F: 0
		};
		S = () => {
			let t = (v.velocity + _ * v.delta) / e;
			a.S = (v.delta + t) / 2, a.F = (v.delta - t) / 2;
		}, b = (e) => v.target - a.S * i(t, e) - a.F * i(n, e), x = (e) => t * a.S * i(t, e) + n * a.F * i(n, e);
	}
	S();
	let C = u && l || null, w = {
		calculatedDuration: C,
		retarget: (e, t) => {
			v.target = e[e.length - 1], v.delta = v.target - e[0], v.velocity = f(t), n.restSpeed && n.restDelta || y(), w.calculatedDuration = C, a.done = !1, S();
		},
		velocity: (e) => /* @__PURE__ */ h(x(e)),
		next: (e) => {
			let t = b(e);
			if (u) a.done = e >= l;
			else {
				let n = /* @__PURE__ */ h(x(e));
				a.done = Math.abs(n) <= v.restSpeed && Math.abs(v.target - t) <= v.restDelta;
			}
			return a.value = a.done ? v.target : t, a;
		},
		toString: () => {
			let e = Math.min(wt(w), Ct), t = St((t) => w.next(e * t).value, e, 30);
			return e + "ms " + t;
		},
		toTransition: () => {}
	};
	return w;
}
var Xt = /* @__PURE__ */ Object.assign(Yt, { applyToOptions: (e) => {
	let t = Tt(e, 100, Yt);
	return e.ease = t.ease, e.duration = /* @__PURE__ */ h(t.duration), e.type = "keyframes", e;
} });
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/generators/inertia.mjs
function Zt({ keyframes: e, velocity: t = 0, power: n = .8, timeConstant: r = 325, bounceDamping: i = 10, bounceStiffness: a = 500, modifyTarget: o, min: s, max: c, restDelta: l = .5, restSpeed: u }) {
	let d = e[0], f = {
		done: !1,
		value: d
	}, p = (e) => e < s || e > c, m = (e) => s === void 0 ? c : c === void 0 || Math.abs(s - e) < Math.abs(c - e) ? s : c, h = n * t, g = d + h, _ = o ? o(g) : g;
	_ !== g && (h = _ - d);
	let v = (e) => -h * Math.exp(-e / r), y = (e) => {
		let t = v(e);
		f.done = Math.abs(t) <= l, f.value = f.done ? _ : e ? _ + t : d;
	}, b, x, S = (e) => {
		p(f.value) && (b = e, x = Xt({
			keyframes: [f.value, m(f.value)],
			velocity: -v(e) / r * 1e3,
			damping: i,
			stiffness: a,
			restDelta: l,
			restSpeed: u
		}));
	};
	return S(0), {
		calculatedDuration: null,
		next: (e) => {
			let t = !1;
			return !x && b === void 0 && (t = !0, y(e), S(e)), b !== void 0 && e >= b ? x.next(e - b) : (!t && y(e), f);
		}
	};
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/utils/interpolate.mjs
function Qt(e, t, n) {
	let r = [], i = n || o.mix || mt, a = e.length - 1;
	for (let n = 0; n < a; n++) {
		let a = i(e[n], e[n + 1]);
		t && (a = f(Array.isArray(t) ? t[n] || d : t, a)), r.push(a);
	}
	return r;
}
function $t(e, t, { clamp: r = !0, ease: i, mixer: o } = {}) {
	let s = e.length;
	if (process.env.NODE_ENV !== "production" && a(s === t.length, "Both input and output ranges must be the same length", "range-length"), s === 1) return () => t[0];
	if (s === 2 && t[0] === t[1]) return () => t[1];
	let c = e[0] === e[1];
	e[0] > e[s - 1] && (e = [...e].reverse(), t = [...t].reverse());
	let l = Qt(t, i, o), u = l.length, d = (n) => {
		if (c && n < e[0]) return t[0];
		let r = 0;
		if (u > 1) for (; r < e.length - 2 && !(n < e[r + 1]); r++);
		let i = /* @__PURE__ */ p(e[r], e[r + 1], n);
		return l[r](i);
	};
	return r ? (t) => d(n(e[0], e[s - 1], t)) : d;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/keyframes/offsets/fill.mjs
function en(e, t) {
	let n = e[e.length - 1];
	for (let r = 1; r <= t; r++) {
		let i = /* @__PURE__ */ p(0, t, r);
		e.push(H(n, 1, i));
	}
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/keyframes/offsets/default.mjs
function tn(e) {
	let t = [0];
	return en(t, e.length - 1), t;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/keyframes/offsets/time.mjs
function nn(e, t) {
	return e.map((e) => e * t);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/generators/keyframes.mjs
function rn(e, t) {
	return e.map(() => t || ie).splice(0, e.length - 1);
}
function W({ duration: e = 300, keyframes: t, times: r, ease: i = "easeInOut" }) {
	let a = /* @__PURE__ */ ae(i) ? i.map(ue) : ue(i) || ie, s = {
		done: !1,
		value: t[0]
	};
	if (t.length === 2 && !Array.isArray(a) && (!r || r.length !== 2 || r[0] === 0 && r[1] === 1)) {
		let [r, i] = t, c = r === i ? void 0 : (o.mix || mt)(r, i);
		return {
			calculatedDuration: e,
			next: (t) => (s.value = c ? c(a(e > 0 ? n(0, 1, t / e) : 1)) : i, s.done = t >= e, s)
		};
	}
	let c = $t(nn(r && r.length === t.length ? r : tn(t), e), t, { ease: Array.isArray(a) ? a : rn(t, a) });
	return {
		calculatedDuration: e,
		next: (t) => (s.value = c(t), s.done = t >= e, s)
	};
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/generators/utils/velocity.mjs
var an = 5;
function on(e, t, n) {
	let r = Math.max(t - an, 0);
	return /* @__PURE__ */ _(n - e(r), t - r);
}
function sn(e, t, n = 0) {
	return t <= 0 ? n : e.velocity ? e.velocity(t) : on((t) => e.next(t).value, t, e.next(t).value);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/keyframes/get-final.mjs
var cn = (e) => e !== null;
function G(e, { repeat: t, repeatType: n = "loop" }, r, i = 1) {
	let a = e.filter(cn), o = i < 0 || t && n !== "loop" && t % 2 == 1 ? 0 : a.length - 1;
	return !o || r === void 0 ? a[o] : r;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/utils/replace-transition-type.mjs
var ln = {
	decay: Zt,
	inertia: Zt,
	tween: W,
	keyframes: W,
	spring: Xt
};
function un(e) {
	typeof e.type == "string" && (e.type = ln[e.type]);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/utils/resolve-start-time.mjs
var dn = 40, fn = (e, t) => t - e > dn && !o.useManualTiming ? t : e;
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/utils/notify-inspector.mjs
function pn(e, t) {
	return {
		kind: e,
		animation: t,
		timestamp: j.now(),
		frameTimestamp: A.timestamp,
		frameIsProcessing: A.isProcessing
	};
}
function mn(e, t, n) {
	let r = globalThis.__MOTION_INSPECT__;
	if (r) try {
		r({
			...pn("animation-start", e),
			options: n ? {
				...t,
				...n
			} : t
		});
	} catch {}
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/utils/WithPromise.mjs
var hn = class {
	constructor() {
		this.isResolved = !1;
	}
	get finished() {
		return this._finished ||= this.isResolved ? Promise.resolve() : new Promise((e) => {
			this._resolve = e;
		}), this._finished;
	}
	updateFinished() {
		this._finished = this._resolve = void 0, this.isResolved = !1;
	}
	notifyFinished() {
		this.isResolved = !0, this._resolve?.();
	}
	then(e, t) {
		return this.finished.then(e, t);
	}
}, gn = (e) => e / 100, _n = (e) => Math.round(e * 1e4) / 1e4, K = class extends hn {
	constructor(e) {
		super(), this.state = "idle", this.startTime = null, this.isStopped = !1, this.currentTime = 0, this.holdTime = null, this.playbackSpeed = 1, this.delayState = {
			done: !1,
			value: void 0
		}, this.stop = () => {
			let { motionValue: e } = this.options;
			e && e.updatedAt !== j.now() && this.tick(j.now()), this.isStopped = !0, this.state !== "idle" && (this.teardown(), this.options.onStop?.());
		}, this.options = e, this.initAnimation(), this.play(), e.autoplay === !1 && this.pause(), mn(this, this.options);
	}
	initAnimation() {
		let { options: e } = this;
		un(e);
		let { type: t = W, repeat: n = 0, repeatDelay: r = 0, repeatType: i, velocity: o = 0 } = e, { keyframes: s } = e, c = t || W;
		process.env.NODE_ENV !== "production" && c !== W && a(s.length <= 2, `Only two keyframes currently supported with spring and inertia animations. Trying to animate ${s}`, "spring-two-frames"), c !== W && typeof s[0] != "number" && (this.mixKeyframes = f(gn, mt(s[0], s[1])), s = [0, 100]);
		let l = c(s === e.keyframes ? e : {
			...e,
			keyframes: s
		});
		i === "mirror" && (this.mirroredGenerator = c({
			...e,
			keyframes: [...s].reverse(),
			velocity: -o
		})), l.calculatedDuration === null && (l.calculatedDuration = wt(l));
		let { calculatedDuration: u } = l;
		this.calculatedDuration = u, this.resolvedDuration = u + r, this.totalDuration = this.resolvedDuration * (n + 1) - r, this.generator = l;
	}
	updateTime(e) {
		this.currentTime = this.holdTime ?? Math.round(e - this.startTime) * this.playbackSpeed;
	}
	tick(e, t = !1) {
		let { generator: n, totalDuration: r, calculatedDuration: i } = this;
		if (this.startTime === null) return n.next(0);
		let { delay: a = 0, keyframes: o, type: s, onUpdate: c, finalKeyframe: l } = this.options;
		this.startTime === this.pendingStartTime && (this.startTime = fn(this.startTime, e)), this.pendingStartTime = void 0, this.speed > 0 ? this.startTime = Math.min(this.startTime, e) : this.speed < 0 && (this.startTime = Math.min(e - r / this.speed, this.startTime)), t ? this.currentTime = e : this.updateTime(e);
		let u = this.currentTime - a * (this.playbackSpeed >= 0 ? 1 : -1), d = this.playbackSpeed >= 0 ? u < 0 : u > r;
		this.currentTime = Math.max(u, 0), this.state === "finished" && this.holdTime === null && (this.currentTime = r);
		let f = this.generate(this.currentTime, d), { done: p } = f;
		d || (p = this.playbackSpeed >= 0 ? i < Infinity ? this.currentTime >= r : p : this.currentTime <= 0);
		let m = this.holdTime === null && (this.state === "finished" || this.state === "running" && p);
		return m && s !== Zt && (f.value = G(o, this.options, l, this.speed)), c && c(f.value), m && this.finish(), f;
	}
	at(e) {
		return this.holdTime ?? _n((e - this.startTime) * this.playbackSpeed);
	}
	sampleAt(e, t) {
		let { options: n, totalDuration: r } = this, i = this.at(e) - (n.delay || 0);
		return i >= r && n.type !== Zt ? G(n.keyframes, n, t ? void 0 : n.finalKeyframe) : this.generate(Math.max(i, 0), i < 0).value;
	}
	generate(e, t) {
		let { generator: r, totalDuration: i, mixKeyframes: a, mirroredGenerator: o, resolvedDuration: s } = this, { keyframes: c, repeat: l, repeatType: u, repeatDelay: d } = this.options, f = e, p = r;
		if (l) {
			let t = Math.min(e, i) / s, r = Math.floor(t), a = t % 1;
			!a && t >= 1 && (a = 1), a === 1 && r--, r = Math.min(r, l + 1), r % 2 && (u === "reverse" ? (a = 1 - a, d && (a -= d / s)) : u === "mirror" && (p = o)), f = n(0, 1, a) * s;
		}
		let m;
		return t ? (this.delayState.value = c[0], m = this.delayState) : m = p.next(f), a && !t && (m.value = a(m.value)), m;
	}
	get duration() {
		return /* @__PURE__ */ g(this.calculatedDuration);
	}
	get iterationDuration() {
		return this.duration + /* @__PURE__ */ g(this.options.delay ?? 0);
	}
	get time() {
		return /* @__PURE__ */ g(this.currentTime);
	}
	set time(e) {
		e = /* @__PURE__ */ h(e), this.currentTime = e, this.startTime === null || this.holdTime !== null || this.playbackSpeed === 0 ? this.holdTime = e : this.driver && (this.startTime = this.driver.now() - e / this.playbackSpeed), this.driver ? this.driver.start(!1) : (this.startTime = 0, this.state = "paused", this.holdTime = e, this.tick(e));
	}
	getGeneratorVelocity() {
		return sn(this.generator, this.currentTime, this.options.velocity);
	}
	get speed() {
		return this.playbackSpeed;
	}
	set speed(e) {
		let t = this.playbackSpeed !== e;
		t && this.driver && this.updateTime(j.now()), this.playbackSpeed = e, t && this.driver && (this.time = /* @__PURE__ */ g(this.currentTime));
	}
	play() {
		if (this.isStopped) return;
		let { driver: e = xt, startTime: t } = this.options;
		this.driver ||= e((e) => this.tick(e)), this.options.onPlay?.();
		let n = this.driver.now();
		this.state === "finished" ? (this.updateFinished(), this.startTime = n) : this.holdTime === null ? this.startTime ||= t ?? (this.pendingStartTime = n) : this.startTime = n - this.holdTime / (this.playbackSpeed || 1), this.state === "finished" && this.speed < 0 && (this.startTime += this.calculatedDuration), this.holdTime = null, this.state = "running", this.driver.start();
	}
	pause() {
		this.state = "paused", this.updateTime(j.now()), this.holdTime = this.currentTime;
	}
	complete() {
		this.state !== "running" && this.play(), this.state = "finished", this.holdTime = null;
	}
	finish() {
		this.notifyFinished(), this.teardown(), this.state = "finished", this.options.onComplete?.();
	}
	cancel() {
		this.holdTime = null, this.startTime = 0, this.tick(0), this.teardown(), this.options.onCancel?.();
	}
	teardown() {
		this.state = "idle", this.driver?.stop(), this.driver = void 0, this.startTime = this.holdTime = null;
	}
	sample(e) {
		return this.startTime = 0, this.tick(e, !0);
	}
	attachTimeline(e) {
		return this.options.allowFlatten && (this.options.type = "keyframes", this.options.ease = "linear", this.initAnimation()), this.driver?.stop(), e.observe(this);
	}
}, vn = /* @__PURE__ */ new Set([
	"brightness",
	"contrast",
	"saturate",
	"opacity"
]);
function yn(e) {
	let [t, n] = e.slice(0, -1).split("(");
	if (t === "drop-shadow") return e;
	let [r] = n.match(ye) || [];
	if (!r) return e;
	let i = n.replace(r, ""), a = +!!vn.has(t);
	return r !== n && (a *= 100), t + "(" + a + i + ")";
}
var bn = /\b([a-z-]*)\(.*?\)/gu, xn = {
	...V,
	getAnimatableNone: (e) => {
		let t = e.match(bn);
		return t ? t.map(yn).join(" ") : e;
	}
}, Sn = {
	...V,
	getAnimatableNone: (e) => {
		let t = V.parse(e);
		return V.createTransformer(e)(t.map((e) => typeof e == "number" ? 0 : typeof e == "object" ? {
			...e,
			alpha: 1
		} : e));
	}
}, Cn = {
	...N,
	transform: Math.round
}, wn = {
	rotate: F,
	pathRotation: F,
	rotateX: F,
	rotateY: F,
	rotateZ: F,
	scale: ve,
	scaleX: ve,
	scaleY: ve,
	scaleZ: ve,
	skew: F,
	skewX: F,
	skewY: F,
	distance: L,
	translateX: L,
	translateY: L,
	translateZ: L,
	x: L,
	y: L,
	z: L,
	perspective: L,
	transformPerspective: L,
	opacity: _e,
	originX: Me,
	originY: Me,
	originZ: L
}, q = {
	borderWidth: L,
	borderTopWidth: L,
	borderRightWidth: L,
	borderBottomWidth: L,
	borderLeftWidth: L,
	borderRadius: L,
	borderTopLeftRadius: L,
	borderTopRightRadius: L,
	borderBottomRightRadius: L,
	borderBottomLeftRadius: L,
	width: L,
	maxWidth: L,
	height: L,
	maxHeight: L,
	top: L,
	right: L,
	bottom: L,
	left: L,
	inset: L,
	insetBlock: L,
	insetBlockStart: L,
	insetBlockEnd: L,
	insetInline: L,
	insetInlineStart: L,
	insetInlineEnd: L,
	padding: L,
	paddingTop: L,
	paddingRight: L,
	paddingBottom: L,
	paddingLeft: L,
	paddingBlock: L,
	paddingBlockStart: L,
	paddingBlockEnd: L,
	paddingInline: L,
	paddingInlineStart: L,
	paddingInlineEnd: L,
	margin: L,
	marginTop: L,
	marginRight: L,
	marginBottom: L,
	marginLeft: L,
	marginBlock: L,
	marginBlockStart: L,
	marginBlockEnd: L,
	marginInline: L,
	marginInlineStart: L,
	marginInlineEnd: L,
	fontSize: L,
	backgroundPositionX: L,
	backgroundPositionY: L,
	...wn,
	zIndex: Cn,
	fillOpacity: _e,
	strokeOpacity: _e,
	numOctaves: Cn
}, Tn = {
	...q,
	color: z,
	backgroundColor: z,
	outlineColor: z,
	fill: z,
	stroke: z,
	borderColor: z,
	borderTopColor: z,
	borderRightColor: z,
	borderBottomColor: z,
	borderLeftColor: z,
	filter: xn,
	WebkitFilter: xn,
	mask: Sn,
	WebkitMask: Sn
}, En = (e) => Tn[e], Dn = /*@__PURE__*/ new Set([xn, Sn]);
function On(e, t) {
	let n = En(e);
	return Dn.has(n) || (n = V), n.getAnimatableNone ? n.getAnimatableNone(t) : void 0;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/keyframes/utils/fill-wildcards.mjs
function kn(e) {
	for (let t = 1; t < e.length; t++) e[t] ?? (e[t] = e[t - 1]);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/render/dom/parse-transform.mjs
var J = (e) => e * 180 / Math.PI, An = (e) => Mn(J(Math.atan2(e[1], e[0]))), jn = {
	x: 4,
	y: 5,
	translateX: 4,
	translateY: 5,
	scaleX: 0,
	scaleY: 3,
	scaleZ: () => 1,
	scale: (e) => (Math.abs(e[0]) + Math.abs(e[3])) / 2,
	rotate: An,
	rotateZ: An,
	skewX: (e) => J(Math.atan(e[1])),
	skewY: (e) => J(Math.atan(e[2])),
	skew: (e) => (Math.abs(e[1]) + Math.abs(e[2])) / 2
}, Mn = (e) => (e %= 360, e < 0 && (e += 360), e), Nn = An, Pn = (e) => Math.hypot(e[0], e[1]), Fn = (e) => Math.hypot(e[4], e[5]), In = {
	x: 12,
	y: 13,
	z: 14,
	translateX: 12,
	translateY: 13,
	translateZ: 14,
	scaleX: Pn,
	scaleY: Fn,
	scaleZ: (e) => Math.hypot(e[8], e[9], e[10]),
	scale: (e) => (Pn(e) + Fn(e)) / 2,
	rotateX: (e) => Mn(J(Math.atan2(e[6], e[5]))),
	rotateY: (e) => Mn(J(Math.atan2(-e[2], e[0]))),
	rotateZ: Nn,
	rotate: Nn,
	skewX: (e) => J(Math.atan(e[4])),
	skewY: (e) => J(Math.atan(e[1])),
	skew: (e) => (Math.abs(e[1]) + Math.abs(e[4])) / 2
};
function Ln(e) {
	return +!!e.includes("scale");
}
function Rn(e, t) {
	if (!e || e === "none") return Ln(t);
	let n = e.match(/^matrix(3d)?\(([-\d.e\s,]+)\)$/u);
	if (!n) return Ln(t);
	let r = (n[1] ? In : jn)[t], i = n[2].split(",").map((e) => parseFloat(e));
	return typeof r == "function" ? r(i) : i[r];
}
var zn = (e, t) => {
	let { transform: n = "none" } = getComputedStyle(e);
	return Rn(n, t);
}, Y = [
	"transformPerspective",
	"x",
	"y",
	"z",
	"translateX",
	"translateY",
	"translateZ",
	"scale",
	"scaleX",
	"scaleY",
	"scaleZ",
	"rotate",
	"rotateX",
	"rotateY",
	"rotateZ",
	"skew",
	"skewX",
	"skewY"
], X = /* @__PURE__ */ new Set([...Y, "pathRotation"]), Bn = (e) => e === N || e === L, Vn = /* @__PURE__ */ new Set([
	"x",
	"y",
	"z"
]), Hn = /* @__PURE__ */ Y.filter((e) => !Vn.has(e));
function Un(e) {
	let t = [];
	return Hn.forEach((n) => {
		let r = e.getValue(n);
		if (r !== void 0) {
			let e = r.get(), i = +!!n.startsWith("scale");
			if (e === i) return;
			t.push([n, e]), r.set(i);
		}
	}), t;
}
var Wn = /* @__PURE__ */ new Set(["bottom", "right"]);
function Gn(e, t, n, r, i, a) {
	let o = parseFloat(e);
	if (!isNaN(o)) return o;
	let { min: s, max: c } = t()[n], l = c - s;
	return a === "border-box" ? l : l - parseFloat(r) - parseFloat(i);
}
var Kn = ({ transform: e }) => Rn(e, "x"), qn = ({ transform: e }) => Rn(e, "y"), Jn = {
	width: ({ width: e, paddingLeft: t = "0", paddingRight: n = "0", boxSizing: r }, i) => Gn(e, i, "x", t, n, r),
	height: ({ height: e, paddingTop: t = "0", paddingBottom: n = "0", boxSizing: r }, i) => Gn(e, i, "y", t, n, r),
	top: ({ top: e }) => parseFloat(e),
	left: ({ left: e }) => parseFloat(e),
	bottom: ({ top: e }, t) => {
		let { y: n } = t();
		return parseFloat(e) + (n.max - n.min);
	},
	right: ({ left: e }, t) => {
		let { x: n } = t();
		return parseFloat(e) + (n.max - n.min);
	},
	x: Kn,
	y: qn,
	translateX: Kn,
	translateY: qn
}, Z = /* @__PURE__ */ new Set(), Yn = !1, Xn = !1, Zn = !1;
function Qn() {
	if (Xn) {
		let e = [], t = /* @__PURE__ */ new Set(), n = /* @__PURE__ */ new Set();
		Z.forEach((r) => {
			r.needsMeasurement && (e.push(r), t.add(r.element), Wn.has(r.name) && n.add(r.element));
		});
		let r = /* @__PURE__ */ new Map();
		n.forEach((e) => {
			let t = Un(e);
			t.length && (r.set(e, t), e.render());
		}), e.forEach((e) => e.measureInitialState()), t.forEach((e) => {
			e.render();
			let t = r.get(e);
			t && t.forEach(([t, n]) => {
				e.getValue(t)?.set(n);
			});
		}), e.forEach((e) => e.measureEndState()), e.forEach((e) => {
			e.suspendedScrollY !== void 0 && window.scrollTo(0, e.suspendedScrollY);
		});
	}
	Xn = !1, Yn = !1, Z.forEach((e) => e.complete(Zn)), Z.clear();
}
function $n() {
	Z.forEach((e) => {
		e.readKeyframes(), e.needsMeasurement && (Xn = !0);
	});
}
function er() {
	Zn = !0, $n(), Qn(), Zn = !1;
}
function tr(e, t, n) {
	if (typeof e == "string") {
		if (s(e) || l(e)) return parseFloat(e);
		if (!V.test(e) && V.test(n)) return On(t, n);
	}
	return e ?? void 0;
}
var nr = class {
	constructor(e, t, n, r, i, a = !1) {
		this.state = "pending", this.isAsync = !1, this.needsMeasurement = !1, this.unresolvedKeyframes = [...e], this.onComplete = t, this.name = n, this.motionValue = r, this.element = i, this.isAsync = a;
	}
	scheduleResolve() {
		this.state = "scheduled", this.isAsync ? (Z.add(this), Yn || (Yn = !0, U.read($n), U.resolveKeyframes(Qn))) : (this.readKeyframes(), this.complete());
	}
	readKeyframes() {
		let { unresolvedKeyframes: e, name: t, element: n, motionValue: r } = this;
		if (e[0] === null) {
			let i = r?.get(), a = e[e.length - 1];
			if (i !== void 0) e[0] = i;
			else if (n && t) {
				let r = tr(n.readValue(t, a), t, a);
				r !== void 0 && (e[0] = r);
			}
			e[0] === void 0 && (e[0] = a), r && i === void 0 && r.set(e[0]);
		}
		kn(e);
	}
	setFinalKeyframe() {}
	measureInitialState() {}
	renderEndStyles() {}
	measureEndState() {}
	complete(e = !1) {
		this.state = "complete", this.onComplete(this.unresolvedKeyframes, this.finalKeyframe, e), Z.delete(this);
	}
	cancel() {
		this.state === "scheduled" && (Z.delete(this), this.state = "pending");
	}
	resume() {
		this.state === "pending" && this.scheduleResolve();
	}
}, rr = (e) => e.startsWith("--");
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/render/dom/style-set.mjs
function ir(e, t, n) {
	rr(t) ? e.style.setProperty(t, n) : e.style[t] = n;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/utils/supports/flags.mjs
var ar = {};
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/utils/supports/memo.mjs
function or(e, t) {
	let n = /* @__PURE__ */ u(e);
	return () => ar[t] ?? n();
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/utils/supports/scroll-timeline.mjs
var sr = /* @__PURE__ */ or(() => window.ScrollTimeline !== void 0, "scrollTimeline"), cr = /*@__PURE__*/ or(() => {
	try {
		document.createElement("div").animate({ opacity: 0 }, { easing: "linear(0, 1)" });
	} catch {
		return !1;
	}
	return !0;
}, "linearEasing"), Q = ([e, t, n, r]) => `cubic-bezier(${e}, ${t}, ${n}, ${r})`, lr = {
	linear: "linear",
	ease: "ease",
	easeIn: "ease-in",
	easeOut: "ease-out",
	easeInOut: "ease-in-out",
	circIn: /*@__PURE__*/ Q([
		0,
		.65,
		.55,
		1
	]),
	circOut: /*@__PURE__*/ Q([
		.55,
		0,
		1,
		.45
	]),
	backIn: /*@__PURE__*/ Q([
		.31,
		.01,
		.66,
		-.59
	]),
	backOut: /*@__PURE__*/ Q([
		.33,
		1.53,
		.69,
		.99
	])
};
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/waapi/easing/map-easing.mjs
function ur(e, t) {
	if (e) return typeof e == "function" ? cr() ? St(e, t) : "ease-out" : /* @__PURE__ */ se(e) ? Q(e) : Array.isArray(e) ? e.map((e) => ur(e, t) || lr.easeOut) : lr[e];
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/waapi/start-waapi-animation.mjs
function dr(e, t, n, { delay: r = 0, duration: i = 300, repeat: a = 0, repeatType: o = "loop", ease: s = "easeOut", times: c } = {}, l = void 0) {
	let u = { [t]: n };
	c && (u.offset = c);
	let d = ur(s, i);
	Array.isArray(d) && (u.easing = d);
	let f = {
		delay: r,
		duration: i,
		easing: Array.isArray(d) ? "linear" : d,
		fill: "both",
		iterations: a + 1,
		direction: o === "reverse" ? "alternate" : "normal"
	};
	return l && (f.pseudoElement = l), e.animate(u, f);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/generators/utils/is-generator.mjs
function fr(e) {
	return typeof e == "function" && "applyToOptions" in e;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/waapi/utils/apply-generator.mjs
function pr({ type: e, ...t }) {
	return fr(e) && cr() ? e.applyToOptions(t) : (t.duration ??= 300, t.ease ??= "easeOut", t);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/NativeAnimation.mjs
var mr = class extends hn {
	constructor(e) {
		if (super(), this.finishedTime = null, this.isStopped = !1, this.manualStartTime = null, !e) return;
		let { element: t, name: n, keyframes: r, pseudoElement: i, allowFlatten: o = !1, finalKeyframe: s, onComplete: c } = e;
		this.isPseudoElement = !!i, this.allowFlatten = o, this.options = e, typeof process < "u" && process.env.NODE_ENV !== "production" && a(typeof e.type != "string", "Mini animate() doesn't support \"type\" as a string.", "mini-spring");
		let l = pr(e);
		this.animation = dr(t, n, r, l, i), l.autoplay === !1 && this.animation.pause(), this.animation.onfinish = () => {
			if (this.finishedTime = this.time, !i) {
				let e = G(r, this.options, s, this.speed);
				this.updateMotionValue?.(e), ir(t, n, e), this.animation.cancel();
			}
			c?.(), this.notifyFinished();
		}, mn(this, e, l);
	}
	play() {
		this.isStopped || (this.manualStartTime = null, this.animation.play(), this.state === "finished" && this.updateFinished());
	}
	pause() {
		this.animation.pause();
	}
	complete() {
		this.animation.finish?.();
	}
	cancel() {
		try {
			this.animation.cancel();
		} catch {}
	}
	stop() {
		this.isStopped || (this.isStopped = !0, this.state !== "idle" && this.finishedTime === null && (this.updateMotionValue ? this.updateMotionValue() : this.commitStyles(), this.isPseudoElement || (this.animation.onfinish = null, this.cancel())));
	}
	commitStyles() {
		let e = this.options?.element;
		!this.isPseudoElement && e?.isConnected && this.animation.commitStyles?.();
	}
	get duration() {
		let e = this.animation.effect?.getComputedTiming?.().duration || 0;
		return /* @__PURE__ */ g(Number(e));
	}
	get iterationDuration() {
		let { delay: e = 0 } = this.options || {};
		return this.duration + /* @__PURE__ */ g(e);
	}
	get time() {
		return /* @__PURE__ */ g(Number(this.animation.currentTime) || 0);
	}
	set time(e) {
		let t = this.finishedTime !== null;
		this.manualStartTime = null, this.finishedTime = null, this.animation.currentTime = /* @__PURE__ */ h(e), t && this.animation.pause();
	}
	get speed() {
		return this.animation.playbackRate;
	}
	set speed(e) {
		e < 0 && (this.finishedTime = null), this.animation.playbackRate = e;
	}
	get state() {
		return this.finishedTime === null ? this.animation.playState : "finished";
	}
	get startTime() {
		return this.manualStartTime ?? Number(this.animation.startTime);
	}
	set startTime(e) {
		this.manualStartTime = this.animation.startTime = e;
	}
	attachTimeline({ timeline: e, onAttach: t, observe: n }) {
		return this.allowFlatten && this.animation.effect?.updateTiming({ easing: "linear" }), this.animation.onfinish = null, e && sr() ? (this.animation.timeline = e, t?.(this.animation), d) : n(this);
	}
}, hr = {
	anticipate: D,
	backInOut: ee,
	circInOut: k
};
function gr(e) {
	return e in hr;
}
function _r(e) {
	typeof e.ease == "string" && gr(e.ease) && (e.ease = hr[e.ease]);
}
var vr = class extends mr {
	constructor(e) {
		_r(e), un(e), super(e), e.startTime !== void 0 && e.autoplay !== !1 && (this.startTime = e.startTime), this.options = e;
	}
	elapsed() {
		return this.state === "running" ? (j.now() - this.startTime) * this.speed : this.time * 1e3;
	}
	sample(e) {
		if (!this.sampler) {
			let { motionValue: e, onUpdate: t, onComplete: n, onPlay: r, onStop: i, element: a, ...o } = this.options;
			this.sampler = new K({
				...o,
				autoplay: !1
			}), this.sampler.stop();
		}
		return this.sampler.sample(Math.max(0, e)).value;
	}
	liveValue() {
		let { state: e } = this;
		if (e === "running" || e === "paused") return this.sample(this.elapsed());
	}
	updateMotionValue(e) {
		let { motionValue: t, element: r, name: i } = this.options;
		if (!t) return;
		if (e !== void 0) {
			t.set(e);
			return;
		}
		let { speed: a } = this, o = this.elapsed(), s = this.state === "running" && a ? n(0, 10, o) : 0, c = this.sample(o);
		r && i && ir(r, i, c), t.setWithVelocity(this.sample(o - s * Math.sign(a)), c, s / Math.abs(a || 1));
	}
}, yr = (e, t) => t !== "zIndex" && !!(typeof e == "number" || Array.isArray(e) || typeof e == "string" && (V.test(e) || e === "0") && !e.startsWith("url("));
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/utils/can-animate.mjs
function br(e) {
	let t = e[0];
	if (e.length === 1) return !0;
	for (let n = 0; n < e.length; n++) if (e[n] !== t) return !0;
}
function xr(e, t, n, r) {
	let a = e[0];
	if (a === null) return !1;
	if (t === "display" || t === "visibility") return !0;
	let o = e[e.length - 1], s = yr(a, t), c = yr(o, t);
	return !s || !c ? (s !== c && process.env.NODE_ENV !== "production" && i(!1, `You are trying to animate ${t} from "${a}" to "${o}". "${s ? o : a}" is not an animatable value.`, "value-not-animatable"), !1) : br(e) || (n === "spring" || fr(n)) && r;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/utils/make-animation-instant.mjs
function Sr(e) {
	e.duration = 0, e.type = "keyframes";
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/waapi/utils/accelerated-values.mjs
var Cr = /* @__PURE__ */ new Set([
	"opacity",
	"clipPath",
	"filter",
	"transform"
]), wr = /^(?:oklch|oklab|lab|lch|color|color-mix|light-dark)\(/;
function Tr(e) {
	for (let t = 0; t < e.length; t++) if (typeof e[t] == "string" && wr.test(e[t])) return !0;
	return !1;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/waapi/supports/waapi.mjs
var Er = /* @__PURE__ */ new Set([
	"color",
	"backgroundColor",
	"outlineColor",
	"fill",
	"stroke",
	"borderColor",
	"borderTopColor",
	"borderRightColor",
	"borderBottomColor",
	"borderLeftColor"
]), Dr = () => !o.useManualTiming && Object.hasOwnProperty.call(Element.prototype, "animate");
function Or(e) {
	let { motionValue: t, name: n, repeatDelay: r, repeatType: i, damping: a, type: o, keyframes: s } = e;
	if (!n || !(Cr.has(n) || Er.has(n))) return !1;
	let c = t?.owner?.current;
	if (!(c instanceof HTMLElement) && !(c instanceof SVGElement)) return !1;
	let { onUpdate: l, transformTemplate: u } = t.owner.getProps();
	return Dr() && (Cr.has(n) || Er.has(n) && Tr(s)) && (n !== "transform" || !u) && !l && !r && i !== "mirror" && a !== 0 && o !== "inertia";
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/value/types/utils/get-as-type.mjs
var kr = (e, t) => t && typeof e == "number" ? t.transform(e) : e, Ar = {
	x: "translateX",
	y: "translateY",
	z: "translateZ",
	transformPerspective: "perspective"
};
Y.length;
var jr = {}, Mr = (e, t, n = kr(t, wn[e])) => (jr[e] || (jr[e] = (Ar[e] || e) + "(")) + n + ")", Nr = (e, t) => (typeof t == "number" ? t : parseFloat(t)) === +!!e.startsWith("scale"), Pr = /* @__PURE__ */ new WeakMap(), Fr = 200, Ir = .001, Lr = .1, Rr = .001, zr = 100, Br = (e) => /^(linear|ease(In|Out|InOut))$/.test(e), Vr = (e, t) => e - t, Hr = (e, t, n) => {
	let r = [];
	for (let i = 0; i <= n; i++) r.push(H(e, t, i / n));
	return r;
}, Ur = (e) => e.motionValue.owner, Wr = (e) => Pr.get(e), $ = (e, t) => e.latestValues ? e.latestValues[t] : e.getValue(t)?.get(), Gr = ({ name: e, motionValue: t }) => e && Y.includes(e) && t?.owner?.current instanceof HTMLElement && Dr() && cr();
function Kr(e) {
	let t = Ur(e), { onUpdate: n, transformTemplate: r } = t.getProps();
	return !e.isHandoff && !n && !e.hasOnUpdate && !r && e.type !== "inertia" && ($(t, "transform") || "none") === "none" && !$(t, "pathRotation") && !t.projection?.isProjecting();
}
var qr = class extends K {
	constructor(e) {
		let t = Ur(e).current, { driver: n = xt } = e, r, i = Kr(e);
		e.driver = (e) => {
			let i = n(e);
			return {
				js: i,
				now: i.now,
				start: (e = !0) => {
					let n = Wr(t);
					!n || n.isJS ? i.start(e) : n.schedule(!1, !e);
				},
				stop: () => {
					i.stop();
					let e = Wr(t);
					e && !e.isFinishing && e.release(r);
				}
			};
		}, super(e), r = this, this.canAccelerate = i;
		let { stop: a } = this;
		this.stop = () => {
			this.isAccelerated() && this.sync(), a();
		};
	}
	get group() {
		return Wr(Ur(this.options).current);
	}
	get js() {
		return this.driver?.js;
	}
	get name() {
		return this.options.name;
	}
	timing() {
		let { startTime: e, speed: t, totalDuration: n } = this, { delay: r = 0, repeatType: i } = this.options;
		return this.holdTime === null ? n === Infinity ? [e + r / t, this.resolvedDuration * (i === "loop" ? 1 : 2) / t || 1] : [e + (r + n) / t, 0] : [Infinity, 0];
	}
	isAccelerated() {
		let { group: e, state: t } = this;
		return e?.tracks.has(this) && !e.isJS && this.canAccelerate && (t === "running" || t === "paused");
	}
	liveValue() {
		return this.isAccelerated() ? this.sampleAt(j.now()) : void 0;
	}
	tween() {
		let { keyframes: e, type: t, ease: n, times: r, repeat: i, delay: a = 0 } = this.options, o = /* @__PURE__ */ se(n) ? Q(n) : Br(n) && lr[n];
		if (o && !i && !r && e.length === 2 && t === W && this.holdTime === null) {
			let e = this.startTime + a / this.speed;
			return [
				e,
				e + this.resolvedDuration / this.speed,
				o
			];
		}
	}
	boundaries(e, t) {
		let { startTime: n, speed: r, resolvedDuration: i, options: a } = this, { delay: o = 0, repeat: s = 0, repeatDelay: c = 0, repeatType: l, times: u, keyframes: d, type: f } = a, p = (f || W) === W ? u || tn(d) : [0, 1], m = n + o / r, h = [];
		if (this.holdTime !== null || !(i > 0)) return h;
		for (let n = Math.max(0, Math.floor((e - m) * r / i)); n <= s; n++) {
			let a = m + n * i / r;
			if (a > t) break;
			for (let o of p) {
				let s = a + (n % 2 && l && l !== "loop" ? 1 - o : o) * (i - c) / r;
				s > e && s < t && h.push(s);
			}
		}
		return h;
	}
	numberAt(e) {
		return parseFloat(this.sampleAt(e, !0));
	}
	sync() {
		let e = j.now();
		this.options.motionValue.setWithVelocity(this.sampleAt(e - 10, !0), this.sampleAt(e, !0), 10);
	}
	play() {
		this.isStopped || ((this.group || Jr(Ur(this.options))).tracks.add(this), super.play());
	}
	pause() {
		super.pause(), this.isAccelerated() && (this.sync(), this.group.schedule(!1));
	}
	complete() {
		super.complete();
		let { group: e } = this;
		e && !e.isJS && this.canAccelerate && this.tick(j.now());
	}
	get time() {
		return this.isAccelerated() ? /* @__PURE__ */ g(n(0, this.totalDuration, this.at(j.now()) - (this.options.delay || 0))) : super.time;
	}
	set time(e) {
		super.time = e, this.isAccelerated() && this.sync();
	}
	attachTimeline(e) {
		return this.canAccelerate = !1, this.group?.demote(!0), super.attachTimeline(e);
	}
};
function Jr(e) {
	let t = e.current, n = /* @__PURE__ */ new Set(), r = /* @__PURE__ */ new Map(), i = {}, a = [], o = /* @__PURE__ */ new Map(), s = [], c = !1, l = !1, u = !1, d = !1, f = -Infinity, m = (e) => {
		for (let t of n) if (t.name === e) return !0;
	}, h = (t, n) => {
		let o = {};
		for (let s of t === void 0 ? Y : a) {
			let a = r.get(s), c = t === void 0 ? $(e, s) : a ? a.sampleAt(n > t && !a.timing()[1] ? n : t) : i[s];
			c !== void 0 && (o[s] = c);
		}
		return o;
	}, g = (e, t) => {
		let n = "";
		for (let r in e) {
			let i = e[r];
			(!t || !Nr(r, i)) && (n += Mr(r, i) + " ");
		}
		return (t ? n.trim() : n) || "none";
	}, _ = (e, t) => g(h(e, t)), v = (e = h()) => {
		t.style.transform = g(e, !0);
	}, y = (e = !0) => {
		e && v(), s.forEach(({ animation: e }) => e.cancel()), s = [];
	}, b = (e, n) => new Animation(new KeyframeEffect(t, e, n)), x = (e, t, n = Infinity) => {
		let r = {
			animation: e,
			offset: t,
			end: n
		};
		e.startTime = j.now() + t, n < Infinity && (e.onfinish = () => {
			r.isDone = !0, s.some((e) => e.end === Infinity) && (e.cancel(), s = s.filter((e) => e !== r)), k.schedule(!1);
		}), e.oncancel = () => s.includes(r) && k.demote(), s.push(r);
	}, S = (e, t, n) => {
		let r = (t, n) => Math.abs(e(n) - e(t)), i = r(t, n);
		for (; n - t > .01;) {
			let e = (t + n) / 2;
			r(t, e) > r(e, n) ? n = e : t = e;
		}
		return r(t, n) > i / 2 ? [t, n] : [];
	}, C = (e, t, n, r) => {
		let i = Math.min(Fr, Math.max(2, Math.ceil((n - t) / 10)));
		if (r.length * 4 > i) return;
		let a = Hr(t, n, i).concat(r).sort(Vr), o = (e) => /* @__PURE__ */ p(t, n, e), s, c;
		for (let t of e) {
			let e = a.map((e) => t.numberAt(e)), [n] = e, r = e.map((e) => e - n), i = r[r.length - 1], o = r.some((e) => Math.abs(e) * Ir > Math.abs(i)) ? 0 : i, l = r.map((e) => o ? e / o : e);
			if (!o) {
				if (l.some((e) => !(Math.abs(e) <= Ir))) return;
			} else if (!s) s = l, c = (e) => (t.numberAt(e) - n) / o;
			else if (l.some((e, t) => !(Math.abs(e - s[t]) <= Ir))) return;
		}
		if (!s || s.every((e, t) => Math.abs(e - o(a[t])) <= Ir)) return "linear";
		let l = [], u = (e, t = c(e)) => l.push(_n(t) + " " + _n(o(e) * 100) + "%");
		return s.forEach((e, t) => {
			t && Math.abs(e - s[t - 1]) > .2 && S(c, a[t - 1], a[t]).forEach((e) => u(e)), u(a[t], e);
		}), "linear(" + l + ")";
	}, w = (e, t, n, r) => {
		let i = [t], a = (t, n) => e.every((e) => !(Math.abs(e.numberAt((t + n) / 2) - (e.numberAt(t) + e.numberAt(n)) / 2) > (e.name.startsWith("scale") ? Rr : Lr))), o = (t, n, r) => {
			if (n - t < 1 || a(t, n)) i.push(n);
			else if (r < 4) o(t, (t + n) / 2, r + 1), o((t + n) / 2, n, r + 1);
			else {
				for (let r of e) i.push(...S((e) => r.numberAt(e), t, n));
				i.push(n);
			}
		}, s = Hr(t, n, Math.ceil((n - t) / 100));
		for (let e of r) s.push(e, Math.min(e + .01, n));
		let c = t;
		for (let e of s.sort(Vr)) e > c && o(c, e, 0), c = e;
		return i.sort(Vr);
	}, T = (e) => {
		let t;
		for (let n of e) {
			let e = n.tween();
			if (!e || t?.some((t, n) => n < 2 ? Math.abs(e[n] - t) > 1 : e[n] !== t)) return;
			t = e;
		}
		return t;
	}, E = (e, t, n, r = { fill: "both" }, i, a) => {
		let o = e.flatMap((e) => e.boundaries(t, n)), s = a || C(e, t, n, o), c = s ? [t, n] : w(e, t, n, o), l = c.map((e) => _(e, i)), u = { transform: l };
		return s || (u.offset = c.map((e) => /* @__PURE__ */ p(t, n, e))), l.every((e) => e === l[0]) && (v(h(t, i)), u = null), b(u, {
			...r,
			duration: n - t,
			easing: s || "linear"
		});
	}, ee = (t) => {
		let c = t, l = 0, u = 0, d = [], f = [], p = /* @__PURE__ */ new Set();
		r.clear(), o = /* @__PURE__ */ new Map();
		for (let e of n) {
			r.set(e.name, e);
			let [n, i] = e.timing(), a = n === Infinity;
			if (o.set(e, [
				e.at(t),
				e.speed,
				a
			]), a) e.sync();
			else {
				if (e.speed < 0) return;
				if (i) {
					if (l) {
						let e = (n - u) / i;
						if (Math.abs(i - l) > 1 || Math.abs(e - Math.round(e)) * l > 1) return;
					} else l = i, u = n;
					f.push(e);
				} else p.add(n);
				d.push(e), c = Math.max(c, n);
			}
		}
		i = {}, a = Y.filter((t) => {
			if (r.has(t)) return !0;
			let n = i[t] = $(e, t);
			return n !== void 0 && parseFloat(n) !== +!!t.startsWith("scale");
		}), y(!1);
		let m = !l && T(d);
		try {
			if (m && m[1] > t) {
				let [e, n, r] = m;
				x(E(d, e, n, void 0, void 0, r), e - t, n - e);
			} else c > t && (x(E(d, t, c), 0, c - t), p.forEach((e) => e < c - 1 && x(b(null, { duration: e - t }), 0, e - t)));
			if (l) {
				let e = u + Math.floor((c - u) / l) * l;
				x(E(f, e, e + l, {
					iterations: Infinity,
					iterationStart: (c - e) / l,
					fill: "forwards"
				}, c), c - t);
			}
		} catch {
			return;
		}
		return s.length || y(), !0;
	}, D = (e) => {
		let t, r = 0;
		for (let i of n) {
			let n = o.get(i);
			if (!n) return !1;
			let [a, s, c] = n, l = i.at(e), u = i.timing()[0] === Infinity;
			if (c) {
				if (u && l === a) continue;
				return !1;
			}
			let d = (l - a) / s, f = u ? 0 : i.speed / s;
			if (t === void 0) t = d, r = f;
			else if (Math.abs(d - t) > 1 || f !== r) return !1;
		}
		if (t === void 0) return !0;
		if (!s.length) return !1;
		for (let { offset: e, end: n, isDone: r } of s) {
			let i = t - e;
			if (n < Infinity && (r ? i < n - 1 : i < 0 || i >= n)) return !1;
		}
		for (let { animation: n, offset: i, isDone: a } of s) {
			if (a) continue;
			let o = t - i;
			r && n.updatePlaybackRate && n.playState === "running" && Math.abs(Number(n.currentTime) - o) < 20 ? n.playbackRate !== r && n.updatePlaybackRate(r) : r ? (n.playbackRate = r, n.startTime = e - o / r) : (n.startTime = null, n.currentTime = o);
		}
		return !0;
	}, O = () => !n.size && (u = !0, Wr(t) === k && Pr.delete(t), k.isJS || y(), !0), te = () => {
		let t = j.now();
		if (k.isJS || (k.isFinishing = !0, n.forEach((n) => {
			let [r, a] = n.timing();
			n.state === "running" && n.speed > 0 && !a && r <= t + 1 && (n.complete(), i[n.name] = $(e, n.name), o.has(n) || (c = !0));
		}), k.isFinishing = !1), l = !1, u || (n.forEach(({ state: e }, t) => {
			(e === "idle" || e === "finished") && n.delete(t);
		}), O())) return;
		for (let e of n) if (!e.canAccelerate) return k.demote(!0);
		k.isJS && (k.isJS = !1, c = !0, n.forEach((e) => e.js?.stop()));
		let r = c, a = d;
		if (c = d = !1, r || !D(t)) {
			if (a) {
				if (t - f < zr) return k.demote();
				f = t;
			}
			if (!ee(t)) return k.demote();
		}
	}, k = {
		tracks: n,
		isJS: !1,
		isFinishing: !1,
		schedule(e, t) {
			u || (c ||= e, d ||= !!t, l || (l = !0, A.isProcessing ? U.render(te, !1, !0) : queueMicrotask(te)));
		},
		release(e) {
			let { state: t } = e;
			(t === "idle" || t === "finished") && n.delete(e), O() || k.schedule(!0);
		},
		check() {
			if (!k.isJS) {
				for (let t in i) if ($(e, t) !== i[t] && !m(t)) return k.schedule(!0, !0);
			}
		},
		demote(e) {
			if (!(k.isJS || u)) return n.forEach((t) => {
				t.isAccelerated() && t.sync(), e || (t.canAccelerate = !1);
			}), k.isJS = !0, o = /* @__PURE__ */ new Map(), y(), n.forEach((e) => e.state === "running" && e.js?.start()), !0;
		}
	};
	return Pr.set(t, k), k;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/AsyncMotionValueAnimation.mjs
var Yr = class extends hn {
	constructor(e) {
		super(), this.stop = () => {
			this._animation && (this._animation.stop(), this.stopTimeline?.()), this.keyframeResolver?.cancel();
		}, this.createdAt = j.now();
		let { keyframes: t, name: n, motionValue: r, element: i } = e, a = e;
		a.autoplay ??= !0, a.delay ??= 0, a.type ??= "keyframes", a.repeat ??= 0, a.repeatDelay ??= 0, a.repeatType ??= "loop";
		let o = i?.KeyframeResolver || nr;
		this.keyframeResolver = new o(t, (e, t, n) => this.onKeyframesResolved(e, t, a, !n), n, r, i), this.keyframeResolver?.scheduleResolve();
	}
	onKeyframesResolved(e, t, n, r) {
		this.keyframeResolver = void 0;
		let { name: i, type: a, velocity: s, delay: c, isHandoff: l, onUpdate: u } = n;
		this.resolvedAt = j.now();
		let d = xr(e, i, a, s);
		d || ((o.instantAnimations || !c) && u?.(G(e, n, t)), e[0] = e[e.length - 1], Sr(n), n.repeat = 0);
		let { onComplete: f } = n;
		n.finalKeyframe = t, n.keyframes = e, n.onComplete = () => {
			f?.(), this.notifyFinished();
		};
		let p = d && !l && Or(n), m = !p && Gr(n);
		r && (p || m || this.resolvedAt !== this.createdAt) && (n.startTime ??= fn(this.createdAt, this.resolvedAt));
		let h;
		if (p) {
			n.element = n.motionValue?.owner?.current;
			try {
				h = new vr(n);
			} catch {
				h = new K(n);
			}
		} else h = m ? new qr(n) : new K(n);
		this.pendingTimeline &&= (this.stopTimeline = h.attachTimeline(this.pendingTimeline), void 0), this._animation = h;
	}
	get finished() {
		return this._animation ? this._animation.finished : super.finished;
	}
	then(e, t) {
		return this.finished.finally(e).then(() => {});
	}
	liveValue() {
		return this._animation?.liveValue?.();
	}
	get animation() {
		return this._animation || (this.keyframeResolver?.resume(), er()), this._animation;
	}
	get duration() {
		return this.animation.duration;
	}
	get iterationDuration() {
		return this.animation.iterationDuration;
	}
	get time() {
		return this.animation.time;
	}
	set time(e) {
		this.animation.time = e;
	}
	get speed() {
		return this.animation.speed;
	}
	get state() {
		return this.animation.state;
	}
	set speed(e) {
		this.animation.speed = e;
	}
	get startTime() {
		return this.animation.startTime;
	}
	attachTimeline(e) {
		return this._animation ? this.stopTimeline = this.animation.attachTimeline(e) : this.pendingTimeline = e, () => this.stop();
	}
	play() {
		this.animation.play();
	}
	pause() {
		this.animation.pause();
	}
	complete() {
		this.animation.complete();
	}
	cancel() {
		this._animation?.cancel(), this.keyframeResolver?.cancel();
	}
}, Xr = class {
	constructor(e) {
		this.stop = () => this.runAll("stop"), this.animations = e.filter(Boolean);
	}
	get finished() {
		return Promise.all(this.animations.map((e) => e.finished));
	}
	getAll(e) {
		return this.animations[0][e];
	}
	setAll(e, t) {
		for (let n = 0; n < this.animations.length; n++) this.animations[n][e] = t;
	}
	attachTimeline(e) {
		let t = this.animations.map((t) => t.attachTimeline(e));
		return () => {
			t.forEach((e, t) => {
				e && e(), this.animations[t].stop();
			});
		};
	}
	get time() {
		return this.getAll("time");
	}
	set time(e) {
		this.setAll("time", e);
	}
	get speed() {
		return this.getAll("speed");
	}
	set speed(e) {
		this.setAll("speed", e);
	}
	get state() {
		return this.getAll("state");
	}
	get startTime() {
		return this.getAll("startTime");
	}
	get duration() {
		return Zr(this.animations, "duration");
	}
	get iterationDuration() {
		return Zr(this.animations, "iterationDuration");
	}
	runAll(e) {
		this.animations.forEach((t) => t[e]());
	}
	play() {
		this.runAll("play");
	}
	pause() {
		this.runAll("pause");
	}
	cancel() {
		this.runAll("cancel");
	}
	complete() {
		this.runAll("complete");
	}
};
function Zr(e, t) {
	let n = 0;
	for (let r = 0; r < e.length; r++) {
		let i = e[r][t];
		i !== null && i > n && (n = i);
	}
	return n;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/GroupAnimationWithThen.mjs
var Qr = class extends Xr {
	then(e, t) {
		return this.finished.finally(e).then(() => {});
	}
}, $r = 30, ei = (e) => !isNaN(parseFloat(e)), ti = { current: void 0 }, ni = class {
	constructor(e, t = {}) {
		this.canTrackVelocity = null, this.events = {}, this.updateAndNotify = (e) => {
			let t = j.now();
			if (this.updatedAt !== t && this.setPrevFrameValue(), this.prev = this.current, this.setCurrent(e), this.current !== this.prev && (this.dirty(), this.dependents)) for (let e of this.dependents) e.dirty();
		}, this.hasAnimated = !1, this.setCurrent(e), this.owner = t.owner;
	}
	setCurrent(e) {
		this.current = e, this.updatedAt = j.now(), this.canTrackVelocity === null && e !== void 0 && (this.canTrackVelocity = ei(this.current));
	}
	setPrevFrameValue(e = this.current) {
		this.prevFrameValue = e, this.prevUpdatedAt = this.updatedAt;
	}
	onChange(e) {
		return process.env.NODE_ENV !== "production" && y(!1, "value.onChange(callback) is deprecated. Switch to value.on(\"change\", callback)."), this.on("change", e);
	}
	on(e, t) {
		var n;
		return e === "change" ? this.onChangeSubscribe(t) : ((n = this.events)[e] || (n[e] = new m())).add(t);
	}
	onChangeSubscribe(e) {
		let { events: t } = this;
		return !t.change && !this.changeSubscriber ? this.changeSubscriber = e : (t.change || (t.change = new m(), t.change.add(this.changeSubscriber), this.changeSubscriber = void 0), t.change.add(e)), () => {
			this.changeSubscriber === e ? this.changeSubscriber = void 0 : t.change?.remove(e), this.stopIfUnobserved();
		};
	}
	stopIfUnobserved() {
		U.read(() => {
			!this.changeSubscriber && !this.events.change?.getSize() && this.stop();
		});
	}
	clearListeners() {
		this.changeSubscriber = void 0;
		for (let e in this.events) this.events[e].clear();
	}
	attach(e, t) {
		this.passiveEffect = e, this.stopPassiveEffect = t;
	}
	set(e) {
		this.passiveEffect ? this.passiveEffect(e, this.updateAndNotify) : this.updateAndNotify(e);
	}
	setWithVelocity(e, t, n) {
		this.set(t), this.prev = void 0, this.prevFrameValue = e, this.prevUpdatedAt = this.updatedAt - n;
	}
	jump(e, t = !0) {
		this.updateAndNotify(e), this.prev = e, this.prevUpdatedAt = this.prevFrameValue = void 0, t && this.stop(), this.stopPassiveEffect?.();
	}
	dirty() {
		let { current: e, changeSubscriber: t } = this;
		t ? t(e) : this.events.change?.notify(e);
	}
	addDependent(e) {
		(this.dependents ||= /* @__PURE__ */ new Set()).add(e);
	}
	removeDependent(e) {
		this.dependents?.delete(e);
	}
	get() {
		ti.current?.push(this);
		let e = this.animation?.liveValue?.();
		return e === void 0 ? this.current : e;
	}
	getCurrent() {
		return this.current;
	}
	getPrevious() {
		return this.prev;
	}
	getVelocity() {
		let e = j.now();
		if (!this.canTrackVelocity || this.prevFrameValue === void 0 || e - this.updatedAt > $r) return 0;
		let t = Math.min(this.updatedAt - this.prevUpdatedAt, $r);
		return /* @__PURE__ */ _(parseFloat(this.current) - parseFloat(this.prevFrameValue), t);
	}
	start(e) {
		return this.stop(), new Promise((t) => {
			this.hasAnimated = !0;
			let n = !1, r;
			r = e(() => {
				n = !0, this.events.animationComplete?.notify(), this.animation === r && (this.animation = void 0), t();
			}), n || (this.animation = r), this.events.animationStart?.notify();
		});
	}
	stop() {
		this.animation && (this.animation.stop(), this.events.animationCancel?.notify()), this.animation = void 0;
	}
	isAnimating() {
		return !!this.animation;
	}
	destroy() {
		this.dependents?.clear(), this.events.destroy?.notify(), this.clearListeners(), this.stop(), this.stopPassiveEffect?.();
	}
};
function ri(e, t) {
	return new ni(e, t);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/utils/resolve-transition.mjs
function ii(e, t) {
	if (e?.inherit && t) {
		let { inherit: n, ...r } = e;
		return {
			...t,
			...r
		};
	}
	return e;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/utils/get-value-transition.mjs
function ai(e, t) {
	let n = e?.[t] ?? e?.default ?? e;
	return n === e ? n : ii(n, e);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/utils/default-transitions.mjs
var oi = {
	type: "spring",
	stiffness: 500,
	damping: 25,
	restSpeed: 10
}, si = (e) => ({
	type: "spring",
	stiffness: 550,
	damping: e === 0 ? 2 * Math.sqrt(550) : 30,
	restSpeed: 10
}), ci = {
	type: "keyframes",
	duration: .8
}, li = {
	type: "keyframes",
	ease: [
		.25,
		.1,
		.35,
		1
	],
	duration: .3
}, ui = (e, { keyframes: t }) => t.length > 2 ? ci : X.has(e) ? e.startsWith("scale") ? si(t[1]) : oi : li, di = /* @__PURE__ */ new Set([
	"when",
	"delay",
	"delayChildren",
	"staggerChildren",
	"staggerDirection",
	"repeat",
	"repeatType",
	"repeatDelay",
	"from",
	"elapsed",
	"out"
]);
function fi(e) {
	for (let t in e) if (!di.has(t)) return !0;
	return !1;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/interfaces/motion-value.mjs
var pi = (e, t, n, r = {}, i, a) => (s) => {
	let c = ai(r, e) || {}, l = c.delay || r.delay || 0, { elapsed: u = 0 } = r;
	u -= /* @__PURE__ */ h(l);
	let d = {
		keyframes: Array.isArray(n) ? n : [null, n],
		ease: "easeOut",
		velocity: t.getVelocity(),
		...c,
		delay: -u,
		onUpdate: (e) => {
			t.set(e), c.onUpdate && c.onUpdate(e);
		},
		onComplete: () => {
			s(), c.onComplete && c.onComplete();
		},
		name: e,
		motionValue: t,
		element: a ? void 0 : i,
		hasOnUpdate: !!c.onUpdate
	};
	fi(c) || Object.assign(d, ui(e, d)), d.duration &&= /* @__PURE__ */ h(d.duration), d.repeatDelay &&= /* @__PURE__ */ h(d.repeatDelay), d.from !== void 0 && (d.keyframes[0] = d.from);
	let f = !1;
	if ((d.type === !1 || d.duration === 0 && !d.repeatDelay) && (Sr(d), d.delay === 0 && (f = !0)), (o.instantAnimations || o.skipAnimations || i?.shouldSkipAnimations || c.skipAnimations) && (f = !0, Sr(d), d.delay = 0), d.allowFlatten = !c.type && !c.ease, f && !a && t.get() !== void 0) {
		let e = G(d.keyframes, c);
		if (e !== void 0) {
			U.update(() => {
				d.onUpdate(e), d.onComplete();
			});
			return;
		}
	}
	return c.isSync ? new K(d) : new Yr(d);
}, mi = /^var\(--(?:([\w-]+)|([\w-]+), ?([a-zA-Z\d ()%#.,-]+))\)/u;
function hi(e) {
	let t = mi.exec(e);
	if (!t) return [,];
	let [, n, r, i] = t;
	return [`--${n ?? r}`, i];
}
var gi = 4;
function _i(e, t, n = 1) {
	process.env.NODE_ENV !== "production" && a(n <= gi, `Max CSS variable fallback depth detected in property "${e}". This may indicate a circular fallback dependency.`, "max-css-var-depth");
	let [r, i] = hi(e);
	if (!r) return;
	let o = window.getComputedStyle(t).getPropertyValue(r);
	if (o) {
		let e = o.trim();
		return s(e) ? parseFloat(e) : e;
	}
	return me(i) ? _i(i, t, n + 1) : i;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/render/utils/keys-position.mjs
var vi = /* @__PURE__ */ new Set([
	"width",
	"height",
	"top",
	"left",
	"right",
	"bottom",
	...Y
]), yi = (e) => !!(e && e.getVelocity), bi = {
	test: (e) => e === "auto",
	parse: (e) => e
}, xi = (e) => (t) => t.test(e), Si = [
	N,
	L,
	I,
	F,
	je,
	Ae,
	bi
], Ci = (e) => Si.find(xi(e));
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/keyframes/utils/is-none.mjs
function wi(e) {
	return typeof e == "number" ? e === 0 : e === null || e === "none" || e === "0" || l(e);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/keyframes/utils/make-none-animatable.mjs
var Ti = /* @__PURE__ */ new Set([
	"auto",
	"none",
	"0"
]);
function Ei(e, t, n) {
	let r = 0, i;
	for (; r < e.length && !i;) {
		let t = e[r];
		typeof t == "string" && !Ti.has(t) && Ue(t) && (i = e[r]), r++;
	}
	if (i && n) for (let r of t) e[r] !== i && (e[r] = On(n, i));
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/keyframes/DOMKeyframesResolver.mjs
var Di = class extends nr {
	constructor() {
		super(...arguments), this.isAsync = !0;
	}
	scheduleResolve() {
		if (this.canReadNow() && (this.readKeyframes(), !this.needsMeasurement)) return this.complete();
		super.scheduleResolve();
	}
	canReadNow() {
		let { unresolvedKeyframes: e, element: t, motionValue: n } = this, r = e[0] ?? n?.get();
		if (!t?.current || r === void 0) return !1;
		for (let t = 0; t < e.length; t++) if (ge(t ? e[t] : r)) return !1;
		return !0;
	}
	readKeyframes() {
		let { unresolvedKeyframes: e, element: t, name: n } = this;
		if (!t?.current) return;
		super.readKeyframes();
		for (let n = 0; n < e.length; n++) {
			let r = e[n];
			if (typeof r == "string" && (r = r.trim(), me(r))) {
				let i = _i(r, t.current);
				i !== void 0 && (e[n] = i), n === e.length - 1 && (this.finalKeyframe = r);
			}
		}
		if (this.resolveNoneKeyframes(), !vi.has(n) || e.length !== 2) return;
		let [r, i] = e;
		if (typeof r == "number" && typeof i == "number") return;
		let a = Ci(r), o = Ci(i);
		if (ge(r) !== ge(i) && Jn[n]) this.needsMeasurement = !0;
		else if (a !== o) {
			if (Bn(a) && Bn(o)) for (let t = 0; t < e.length; t++) {
				let n = e[t];
				typeof n == "string" && (e[t] = parseFloat(n));
			}
			else Jn[n] && (this.needsMeasurement = !0);
		}
	}
	resolveNoneKeyframes() {
		let { unresolvedKeyframes: e, name: t } = this, n = [];
		for (let t = 0; t < e.length; t++) (e[t] === null || wi(e[t])) && n.push(t);
		n.length && Ei(e, n, t);
	}
	measure() {
		let { element: e, name: t } = this;
		return Jn[t](window.getComputedStyle(e.current), () => e.measureViewportBox());
	}
	measureInitialState() {
		let { element: e, unresolvedKeyframes: t, name: n } = this;
		if (!e?.current) return;
		n === "height" && (this.suspendedScrollY = window.pageYOffset), this.measuredOrigin = this.measure(), t[0] = this.measuredOrigin;
		let r = t[t.length - 1];
		r !== void 0 && this.motionValue?.jump(r, !1);
	}
	measureEndState() {
		let { element: e, unresolvedKeyframes: t } = this;
		if (!e?.current) return;
		this.motionValue?.jump(this.measuredOrigin, !1);
		let n = t.length - 1, r = t[n];
		t[n] = this.measure(), r !== null && this.finalKeyframe === void 0 && (this.finalKeyframe = r), this.resolveNoneKeyframes();
	}
}, Oi = [];
function ki(e) {
	process.env.NODE_ENV !== "production" && a(typeof e.test == "function" && typeof e.read == "function", "Effects passed to animate.addEffect() need test() and read().", "effect-missing-test"), Ai(e), Oi.unshift(e);
}
function Ai(e) {
	t(Oi, e);
}
function ji(e) {
	return Oi.find((t) => t.test(e));
}
function Mi(e, t, n = {}, r) {
	let i = [], { velocity: a, path: o } = n, s = n.reduceMotion ?? r?.shouldReduceMotion;
	o?.animateValues && r && (t = { ...t }, o.animateValues(e, t, n, 0, i));
	for (let o in t) {
		if (o === "transition" || o === "transitionEnd") continue;
		let c = t[o];
		if (c === void 0) continue;
		let l = e(o), u = l.get();
		u !== void 0 && !l.isAnimating() && !Array.isArray(c) && c === u && !a ? U.update(() => l.set(c)) : (l.start(pi(o, l, c, s && vi.has(o) ? { type: !1 } : n, r)), l.animation && i.push(l.animation));
	}
	let { transitionEnd: c } = t;
	if (c) {
		let t = () => U.update(() => {
			for (let t in c) e(t).set(c[t]);
		});
		i.length ? Promise.all(i).then(t) : t();
	}
	return i;
}
function Ni(e, t, n, r, i) {
	return Mi((r) => {
		let o = e.get(t, r);
		if (!o) {
			let s;
			if (!i) {
				let i = n[r];
				s = Pi(i) ?? e.read(t, r, i), process.env.NODE_ENV !== "production" && a(s !== void 0, `"${r}" can't be read from the animated subject. Provide [from, to] keyframes.`, "effect-unreadable-value");
			}
			o = ri(s, { owner: i }), e(t, { [r]: o });
		}
		return o;
	}, n, r, i);
}
function Pi(e) {
	let t = Array.isArray(e) ? e[0] : void 0;
	return t === null ? void 0 : t;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/utils/is-html-element.mjs
function Fi(e) {
	return c(e) && "offsetHeight" in e && !("ownerSVGElement" in e);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/utils/is-svg-element.mjs
function Ii(e) {
	return c(e) && "ownerSVGElement" in e;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/scope/active.mjs
var Li = {};
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/utils/resolve-elements.mjs
function Ri(e, t, n) {
	if (e == null) return [];
	if (e instanceof EventTarget) return [e];
	if (typeof e == "string") {
		let r = t ? t.current : Li.current?.root || document, i = n?.[e] ?? r.querySelectorAll(e);
		return i ? Array.from(i) : [];
	}
	return Array.from(e).filter((e) => e != null);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/effects/MotionValueState.mjs
var zi = class {
	constructor(e = U.render) {
		this.step = e, this.values = /* @__PURE__ */ new Map(), this.pending = [], this.numPending = 0, this.flush = () => {
			let { pending: e, numPending: t } = this;
			this.numPending = 0;
			for (let n = 0; n < t; n++) e[n]();
		};
	}
	set(e, t, n, r) {
		if (this.values.get(e)?.onRemove(), r) for (let e of this.values.values()) e.value === r && (n = e.render);
		let i = () => n && this.schedule(n);
		t.get() !== void 0 && i();
		let a = t.on("change", i), o = () => {
			a(), n && !r && this.cancel(n), this.values.get(e)?.onRemove === o && this.values.delete(e);
		};
		return this.values.set(e, {
			value: t,
			render: r ? void 0 : n,
			onRemove: o
		}), o;
	}
	get(e) {
		return this.values.get(e)?.value;
	}
	release() {
		let e = /* @__PURE__ */ new Map();
		return this.values.forEach((t, n) => {
			e.set(n, t.value), t.onRemove();
		}), this.transformKeys = this.transformValues = void 0, e;
	}
	schedule(e) {
		let { pending: t, numPending: n } = this;
		for (let r = 0; r < n; r++) if (t[r] === e) return;
		n || this.step(this.flush), t[this.numPending++] = e;
	}
	cancel(e) {
		let { pending: t } = this;
		for (let n = 0; n < this.numPending; n++) if (t[n] === e) {
			t[n] = t[--this.numPending];
			return;
		}
	}
};
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/effects/utils/create-effect.mjs
function Bi(e, { step: t, ...n } = {}) {
	let r = /* @__PURE__ */ new WeakMap();
	return Object.assign((n, i) => {
		let a = r.get(n) ?? new zi(t);
		r.set(n, a);
		let o = [];
		for (let t in i) {
			let r = i[t], s = e(n, a, t, r);
			o.push(s);
		}
		return () => {
			for (let e of o) e();
		};
	}, n, {
		get: (e, t) => r.get(e)?.get(t),
		flush: (e) => r.get(e)?.flush(),
		state: (e) => r.get(e)
	});
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/effects/style/transform.mjs
function Vi(e) {
	let t = "", { transformKeys: n = [], transformValues: r = {} } = e;
	for (let e = 0; e < n.length; e++) {
		let i = n[e], a = r[i].getCurrent();
		a !== void 0 && (Nr(i, a) || (t += (t && " ") + Mr(i, a)));
	}
	let i = e.get("pathRotation")?.get();
	return i && (t += (t && " ") + Mr("rotate", i)), t || "none";
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/effects/style/index.mjs
var Hi = /* @__PURE__ */ new Set([
	"originX",
	"originY",
	"originZ"
]), Ui = (e, t) => kr(e.get(t)?.get(), q[t]), Wi = (e, t, n, r) => {
	let i, a;
	if (X.has(n)) {
		if (n !== "pathRotation") {
			let e = t.transformKeys ??= [];
			(t.transformValues ??= {})[n] = r, e.includes(n) || (e.push(n), e.sort((e, t) => Y.indexOf(e) - Y.indexOf(t)));
		}
		t.get("transform") || (!Fi(e) && !t.get("transformBox") && Wi(e, t, "transformBox", new ni("fill-box")), t.set("transform", new ni("none"), () => {
			Pr.get(e)?.check(), e.style.transform = Vi(t);
		})), a = t.get("transform");
	} else Hi.has(n) ? (t.get("transformOrigin") || t.set("transformOrigin", new ni(""), () => {
		let n = Ui(t, "originX") ?? "50%", r = Ui(t, "originY") ?? "50%", i = Ui(t, "originZ") ?? 0;
		e.style.transformOrigin = `${n} ${r} ${i}`;
	}), a = t.get("transformOrigin")) : i = rr(n) ? () => {
		e.style.setProperty(n, r.getCurrent());
	} : () => {
		e.style[n] = kr(r.getCurrent(), q[n]);
	};
	return t.set(n, r, i, a);
}, Gi = (e) => Fi(e) || Ii(e), Ki = (e, t) => {
	if (X.has(t)) return zn(e, t);
	let n = getComputedStyle(e), r = rr(t) ? n.getPropertyValue(t) : n[t];
	return typeof r == "string" && r.trim() || 0;
}, qi = /*@__PURE__*/ Bi(Wi, {
	test: Gi,
	read: Ki
});
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/render/dom/utils/camel-to-dash.mjs
function Ji(e) {
	return e.replace(/([A-Z])/g, (e) => `-${e.toLowerCase()}`);
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/render/svg/utils/build-attrs.mjs
var Yi = [
	"transform",
	"opacity",
	"clipPath",
	"filter",
	"offsetDistance",
	"offsetPath",
	"offsetRotate",
	"offsetAnchor"
];
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/effects/attr/index.mjs
function Xi(e, t) {
	if (!(t in e)) return !1;
	let n = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), t) || Object.getOwnPropertyDescriptor(e, t);
	return n && typeof n.set == "function";
}
var Zi = (e, t, n, r, i = n) => {
	let a = Xi(e, i);
	!a && (i.startsWith("data") || i.startsWith("aria")) && (i = Ji(i));
	let o = q[n] || q[i], s = a ? () => {
		e[i] = kr(r.get(), q[n]);
	} : () => {
		let t = kr(r.get(), o);
		t == null ? e.removeAttribute(i) : e.setAttribute(i, String(t));
	};
	return t.set(n, r, s);
};
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/effects/svg/index.mjs
function Qi(e, t, n, r) {
	return U.render(() => e.setAttribute("pathLength", "1")), n === "pathOffset" ? t.set(n, r, () => {
		let t = r.get();
		e.setAttribute("stroke-dashoffset", `${-t}`);
	}) : (t.get("stroke-dasharray") || t.set("stroke-dasharray", new ni("1 1"), () => {
		let n = t.get("pathLength")?.get() ?? 1, r = t.get("pathSpacing")?.get();
		e.setAttribute("stroke-dasharray", `${n} ${r ?? 1 - Number(n)}`);
	}), t.set(n, r, void 0, t.get("stroke-dasharray")));
}
var $i = /*@__PURE__*/ Bi((e, t, n, r) => n.startsWith("path") && !X.has(n) ? Qi(e, t, n, r) : n.startsWith("attr") ? Zi(e, t, n, r, ea(n)) : (X.has(n) || Hi.has(n) || rr(n) || n in e.style ? Wi : Zi)(e, t, n, r), {
	test: Ii,
	read: (e, t) => X.has(t) ? q[t]?.default || 0 : rr(t) || Yi.includes(t) ? Ki(e, t) || e.getAttribute(Ji(t)) || 0 : (t = ea(t), e.getAttribute(Ji(t)) ?? e.getAttribute(t) ?? void 0)
});
function ea(e) {
	return e.replace(/^attr([A-Z])/, (e, t) => t.toLowerCase());
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/projection/geometry/conversion.mjs
function ta({ top: e, left: t, right: n, bottom: r }) {
	return {
		x: {
			min: t,
			max: n
		},
		y: {
			min: e,
			max: r
		}
	};
}
function na(e, t) {
	if (!t) return e;
	let n = t({
		x: e.left,
		y: e.top
	}), r = t({
		x: e.right,
		y: e.bottom
	});
	return {
		top: n.y,
		left: n.x,
		bottom: r.y,
		right: r.x
	};
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/projection/utils/measure.mjs
function ra(e, t) {
	return ta(na(e.getBoundingClientRect(), t));
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/animate/element.mjs
var ia = {}, aa = (e) => Ii(e) ? $i : qi, oa = class {
	constructor(e, t) {
		this.effect = e, this.current = t, this.KeyframeResolver = Di;
	}
	getValue(e) {
		return this.effect.get(this.current, e);
	}
	readValue(e, t) {
		return this.effect.read(this.current, e, t);
	}
	render() {
		this.effect.flush(this.current);
	}
	measureViewportBox() {
		return ra(this.current);
	}
	getProps() {
		return ia;
	}
};
function sa(e, t, n, r) {
	if (Li.current?.track(e), r) return Mi((e) => r.getValue(e, null), t, n, r);
	let i = aa(e);
	return Ni(i, e, t, n, new oa(i, e));
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/effects/prop/index.mjs
var ca = /*@__PURE__*/ Bi((e, t, n, r) => t.set(n, r, () => {
	e[n] = r.get();
}), {
	test: (e) => c(e),
	read: (e, t) => {
		let n = e[t];
		return typeof n == "string" || typeof n == "number" ? n : void 0;
	}
});
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/animation/animate/single-value.mjs
function la(e, t, n) {
	let r = yi(e) ? e : ri(e);
	return r.start(pi("", r, t, n)), r.animation;
}
//#endregion
//#region node_modules/.pnpm/motion-dom@14.7.1/node_modules/motion-dom/dist/es/render/store.mjs
var ua = /* @__PURE__ */ new WeakMap();
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/utils/is-dom-keyframes.mjs
function da(e) {
	return typeof e == "object" && !Array.isArray(e);
}
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/animate/resolve-subjects.mjs
function fa(e, t, n, r) {
	return e == null ? [] : typeof e == "string" && da(t) ? Ri(e, n, r) : e instanceof NodeList ? Array.from(e) : Array.isArray(e) ? e.filter((e) => e != null) : [e];
}
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/sequence/utils/calc-repeat-duration.mjs
function pa(e, t, n) {
	return e * (t + 1) + n * t;
}
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/sequence/utils/calc-time.mjs
function ma(e, t) {
	if (t.has(e)) return t.get(e);
	let [, n, r] = e.match(/^(.+?)([+-][\d.]+)$/) || [];
	return t.has(n) ? Math.max(0, t.get(n) + parseFloat(r)) : void 0;
}
function ha(e, t, n, r) {
	return typeof t == "number" ? t : t.startsWith("-") || t.startsWith("+") ? Math.max(0, e + parseFloat(t)) : t === "<" ? n : t.startsWith("<") ? Math.max(0, n + parseFloat(t.slice(1))) : ma(t, r) ?? e;
}
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/sequence/utils/edit.mjs
function ga(e, n, r) {
	for (let i = 0; i < e.length; i++) {
		let a = e[i];
		a.at > n && a.at < r && (t(e, a), i--);
	}
}
function _a(e, t, n, r, i, a) {
	ga(e, i, a);
	for (let o = 0; o < t.length; o++) e.push({
		value: t[o],
		at: H(i, a, r[o]),
		easing: /* @__PURE__ */ oe(n, o)
	});
}
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/sequence/utils/normalize-times.mjs
function va(e, t, n = 0) {
	let r = t + 1 + t * n;
	for (let t = 0; t < e.length; t++) e[t] = e[t] / r;
}
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/sequence/utils/sort.mjs
function ya(e, t) {
	return e.at === t.at ? e.value === null ? 1 : t.value === null ? -1 : 0 : e.at - t.at;
}
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/sequence/create.mjs
var ba = "easeInOut", xa = 20;
function Sa(e, { defaultTransition: t = {}, ...n } = {}, r, a, o) {
	let s = t.duration || .3, c = /* @__PURE__ */ new Map(), l = /* @__PURE__ */ new Map(), u = {}, d = /* @__PURE__ */ new Map(), f = 0, m = 0, g = 0, _ = (e, n) => {
		let o = n, c = (e) => typeof e == "number" ? n + e : ha(m, e, f, d);
		for (let n = 0; n < e.length; n++) {
			let p = e[n];
			if (typeof p == "string") {
				d.set(p, m);
				continue;
			}
			if (!Array.isArray(p)) {
				let e = p.at === void 0 ? m : c(p.at);
				"sequence" in p ? (f = m = e, m = _(p.sequence, e), f = e, o = Math.max(o, m)) : d.set(p.name, e);
				continue;
			}
			let [v, y, b = {}] = p;
			b.at !== void 0 && (m = c(b.at));
			let x = 0, S = (e, n, r, o = 0, c = 0) => {
				let l = Ta(e), { delay: u = 0, times: d = tn(l), type: f = t.type || "keyframes", repeat: p, repeatType: _, repeatDelay: v = 0, ...y } = n, { ease: b = t.ease || "easeOut", duration: S } = n, C = typeof u == "function" ? u(o, c) : u, T = l.length, E = fr(f) ? f : a?.[f || "keyframes"];
				if (T <= 2 && E) {
					let e = 100;
					if (T === 2 && Oa(l)) {
						let t = l[1] - l[0];
						e = Math.abs(t);
					}
					let n = {
						...t,
						...y
					};
					S !== void 0 && (n.duration = /* @__PURE__ */ h(S));
					let r = Tt(n, e, E);
					b = r.ease, S = r.duration;
				}
				S ??= s;
				let ee = m + C;
				d.length === 1 && d[0] === 0 && (d[1] = 1);
				let D = d.length - l.length;
				if (D > 0 && en(d, D), l.length === 1 && l.unshift(null), p && typeof process < "u" && process.env.NODE_ENV !== "production" && i(p < xa, `Sequence segments can't repeat ${p} times — ignoring repeat option. Use a value below ${xa} or apply repeat at the sequence level instead.`), p && p < xa) {
					let e = S > 0 ? v / S : 0;
					S = pa(S, p, v);
					let t = [...l], n = [...d];
					b = Array.isArray(b) ? [...b] : [b];
					let r = [...b], i = _ === "reverse" || _ === "mirror", a = t, o = r;
					i && (a = [...t].reverse(), _ === "reverse" && (o = [...r].reverse().map((e) => typeof e == "function" ? /* @__PURE__ */ w(e) : e)));
					for (let s = 0; s < p; s++) {
						let c = i && s % 2 == 0, u = c ? a : t, f = c ? o : r, p = (s + 1) * (1 + e);
						e > 0 && (l.push(l[l.length - 1]), d.push(p), b.push("linear")), l.push(...u);
						for (let e = 0; e < u.length; e++) d.push(n[e] + p), b.push(e === 0 ? "linear" : /* @__PURE__ */ oe(f, e - 1));
					}
					va(d, p, e);
				}
				let O = ee + S;
				_a(r, l, b, d, ee, O), x = Math.max(C + S, x), g = Math.max(O, g);
			};
			if (yi(v)) {
				let e = Ca(v, l);
				S(y, b, wa("default", e));
			} else {
				let e = fa(v, y, r, u), t = e.length;
				for (let n = 0; n < t; n++) {
					y = y, b = b;
					let r = e[n], i = Ca(r, l);
					for (let e in y) S(y[e], Ea(b, e), wa(e, i), n, t);
				}
			}
			f = m, m += x, o = Math.max(o, m);
		}
		return o;
	};
	return _(e, 0), o && (o.duration = g, o.labels = d), l.forEach((e, r) => {
		for (let i in e) {
			let a = e[i];
			a.sort(ya);
			let o = [], s = [], l = [];
			for (let e = 0; e < a.length; e++) {
				let { at: t, value: n, easing: r } = a[e];
				o.push(n), s.push(/* @__PURE__ */ p(0, g, t)), l.push(r || "easeOut");
			}
			s[0] !== 0 && (s.unshift(0), o.unshift(o[0]), l.unshift(ba)), s[s.length - 1] !== 1 && (s.push(1), o.push(null)), c.has(r) || c.set(r, {
				keyframes: {},
				transition: {}
			});
			let u = c.get(r);
			u.keyframes[i] = o;
			let { type: d, ...f } = t;
			u.transition[i] = {
				...f,
				duration: g,
				ease: l,
				times: s,
				...n
			};
		}
	}), c;
}
function Ca(e, t) {
	return !t.has(e) && t.set(e, {}), t.get(e);
}
function wa(e, t) {
	return t[e] || (t[e] = []), t[e];
}
function Ta(e) {
	return Array.isArray(e) ? e : [e];
}
function Ea(e, t) {
	return e && e[t] ? {
		...e,
		...e[t]
	} : { ...e };
}
var Da = (e) => typeof e == "number", Oa = (e) => e.every(Da);
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/animate/subject.mjs
function ka(e, t) {
	return yi(e) || typeof e == "number" || typeof e == "string" && !da(t);
}
function Aa(e, t, n, r) {
	let i = [];
	if (ka(e, t)) i.push(la(e, da(t) && t.default || t, n && (n.default || n)));
	else {
		if (e == null) return i;
		let o = fa(e, t, r), s = o.length;
		process.env.NODE_ENV !== "production" && a(!!s, "No valid elements provided.", "no-valid-elements");
		for (let e = 0; e < s; e++) {
			let r = o[e], a = { ...n };
			"delay" in a && typeof a.delay == "function" && (a.delay = a.delay(e, s)), r instanceof Element ? i.push(...sa(r, t, a, ua.get(r))) : i.push(...Ni(ji(r) ?? ca, r, t, a));
		}
	}
	return i;
}
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/animate/sequence.mjs
function ja(e, t, n, r) {
	let i = [];
	return Sa(e.map((e) => {
		if (Array.isArray(e) && typeof e[0] == "function") {
			let t = e[0], n = ri(0);
			return n.on("change", t), e.length === 1 ? [n, [0, 1]] : e.length === 2 ? [
				n,
				[0, 1],
				e[1]
			] : [
				n,
				e[1],
				e[2]
			];
		}
		return e;
	}), t, n, { spring: Xt }, r).forEach(({ keyframes: e, transition: t }, n) => {
		i.push(...Aa(n, e, t));
	}), i;
}
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/timeline/index.mjs
var Ma = 0;
function Na(e, t) {
	let n = [...e], r = typeof n[0] == "function" ? Math.max(1, n.length - 1) : 2;
	return n[r] = {
		...n[r],
		at: t
	}, n;
}
var Pa = (e, t) => t === void 0 ? e : {
	name: e,
	at: t
};
function Fa(e) {
	e.pause(), e.time = 0, e.stop();
}
var Ia = class e {
	constructor(e = [], n = {}, r) {
		this.options = n, this.entries = [], this.repeatIndex = 0, this.prevTime = 0, this.markers = [], this.labels = /* @__PURE__ */ new Map(), this.totalDuration = 0, this.isDirty = !1, this.isDone = !1, this.isRebuilding = !1, this.playbackSpeed = 1, this.isWrapped = !1, this.stop = () => {
			this.flush(), this.group?.stop();
		}, this.isPaused = n.autoplay === !1, this.newFinished(), e.forEach((e) => this.add(e)), r ? (this.isDirty = !1, this.isWrapped = !0, this.group = new Qr(r), this.watch()) : (this.invalidate(), this.flush());
		let { scope: i } = n;
		i && (i.animations.push(this), this.finished.then(() => t(i.animations, this)));
	}
	add(t, n) {
		return t instanceof e && t.adopt(this), this.push({
			item: t,
			at: n
		});
	}
	call(e, t) {
		return this.push({
			item: e,
			at: t,
			marker: {
				name: "_m" + Ma++,
				time: 0,
				callback: e
			}
		});
	}
	addPause(e, t) {
		return this.push({
			item: t || {},
			at: e,
			marker: {
				name: "_m" + Ma++,
				time: 0,
				callback: t,
				pause: !0
			}
		});
	}
	move(e, t) {
		return this.entries.forEach((n) => {
			n.item === e && (n.at = t);
		}), this.invalidate();
	}
	remove(t) {
		return t instanceof e && (t.parent = void 0), this.entries = this.entries.filter((e) => e.item !== t), this.invalidate();
	}
	clear() {
		return this.entries = [], this.invalidate();
	}
	getLabelTime(e) {
		return this.flush(), this.labels.get(e);
	}
	seek(e) {
		return this.time = this.resolve(e), this;
	}
	playTo(e) {
		let t = this.resolve(e), n = Math.abs(this.speed);
		return this.speed = t < this.time ? -n : n, this.stopAt = t, this.clock || this.invalidate(), this.play(), this;
	}
	reverse() {
		return this.speed = -this.speed, this.play(), this;
	}
	get progress() {
		return this.duration ? this.time / this.duration : 0;
	}
	set progress(e) {
		this.time = e * this.duration;
	}
	get time() {
		return this.active()?.time ?? 0;
	}
	set time(e) {
		this.flush(), this.prevTime = e, this.group && (this.group.time = e), this.repeatIndex = this.currentRepeat();
	}
	get speed() {
		return this.playbackSpeed;
	}
	set speed(e) {
		this.playbackSpeed = e, this.group && (this.group.speed = e);
	}
	get duration() {
		return this.flush(), this.isWrapped ? this.group.duration : this.totalDuration;
	}
	get iterationDuration() {
		return this.flush(), this.isWrapped ? this.group.iterationDuration : this.totalDuration;
	}
	get state() {
		return this.active()?.state ?? "idle";
	}
	get startTime() {
		return this.active()?.startTime ?? null;
	}
	play() {
		this.flush(), this.isPaused = !1, this.group?.play(), this.isDone && (this.newFinished(), this.watch());
	}
	pause() {
		this.flush(), this.isPaused = !0, this.group?.pause();
	}
	cancel() {
		this.flush(), this.group?.cancel();
	}
	complete() {
		this.flush(), this.group?.complete();
	}
	attachTimeline(e) {
		return this.flush(), this.scrollTimeline = e, this.detachScroll = this.group?.attachTimeline(e), () => {
			this.scrollTimeline = void 0, this.detachScroll?.();
		};
	}
	then(e, t) {
		return this.finished.then(e, t);
	}
	active() {
		return this.flush(), this.group?.animations.length ? this.group : void 0;
	}
	push(e) {
		return this.entries.push(e), this.invalidate();
	}
	invalidate() {
		return this.parent ? this.parent.invalidate() : this.isDirty || (this.isDirty = !0, queueMicrotask(() => this.flush())), this;
	}
	flush() {
		this.isDirty && !this.parent && this.build();
	}
	adopt(e) {
		this.group &&= (Fa(this.group), void 0), this.isDirty = !1, this.parent = e;
	}
	build() {
		this.isDirty = !1, this.isWrapped = !1;
		let e = this.group, t = 0;
		e && (this.isRebuilding = !0, this.scrollTimeline ? (this.detachScroll?.(), e.cancel()) : (t = e.animations.length ? e.time : 0, Fa(e)), this.isRebuilding = !1);
		let { defaultTransition: n, onComplete: r, onUpdate: i, onRepeat: a, onReverseComplete: o, autoplay: s, scope: c, ...l } = this.options, u = {};
		c?.reduceMotion !== void 0 && (u.reduceMotion = c.reduceMotion), c?.skipAnimations !== void 0 && (u.skipAnimations = c.skipAnimations), Object.assign(u, l);
		let d = /* @__PURE__ */ new Map(), f = {}, p = ja(this.toSequence(d), {
			defaultTransition: n,
			...u
		}, c, f), m = f.labels, h = u.duration ?? f.duration, g = f.duration ? h / f.duration : 1;
		if (m.forEach((e, t) => m.set(t, e * g)), this.markers = [], d.forEach((e, t) => {
			e.time = m.get(t), m.delete(t), h = Math.max(h, e.time), this.markers.push(e);
		}), this.markers.sort((e, t) => e.time - t.time), this.labels = m, this.totalDuration = h, this.clock = this.clockAnimation = void 0, this.markers.length || this.stopAt !== void 0 || i || a) {
			let e = this.clock = ri(0);
			e.on("change", (t) => e === this.clock && this.onClock(t)), p.unshift(this.clockAnimation = la(e, [0, h], {
				...u,
				duration: h,
				ease: "linear"
			}));
		}
		let _ = this.group = new Qr(p);
		t = Math.min(t, h), this.isDone && t < h && this.newFinished(), this.scrollTimeline ? this.detachScroll = _.attachTimeline(this.scrollTimeline) : (_.speed = this.playbackSpeed, this.isPaused && _.pause(), t && (_.time = t)), this.repeatIndex = this.currentRepeat(), this.prevTime = t || -1, this.watch();
	}
	toSequence(t) {
		return this.entries.map(({ item: n, at: r, marker: i }) => i ? (t.set(i.name, i), Pa(i.name, r)) : n instanceof e ? {
			sequence: n.toSequence(t),
			at: r
		} : typeof n == "string" ? Pa(n, r) : r === void 0 ? n : Array.isArray(n) ? Na(n, r) : {
			...n,
			at: r
		});
	}
	resolve(e) {
		return this.flush(), typeof e == "number" ? e : ma(e, this.labels) ?? this.time;
	}
	currentRepeat() {
		let { repeat: e = 0, repeatDelay: t = 0, delay: n = 0 } = this.options, r = this.totalDuration + t, i = (this.clockAnimation?.time ?? 0) - n;
		return r && i > 0 ? Math.min(e, Math.floor(i / r)) : 0;
	}
	onClock(e) {
		let t = this.prevTime;
		if (this.prevTime = e, this.isRebuilding) return;
		let { onUpdate: n, onRepeat: r, repeatType: i = "loop" } = this.options;
		n?.(e);
		let a = this.currentRepeat();
		if (a !== this.repeatIndex && (this.repeatIndex = a, r?.(), i === "loop")) {
			let e = this.speed > 0;
			if (this.cross(t, e ? this.totalDuration : 0)) return;
			t = e ? -1 : Infinity;
		}
		this.cross(t, e);
	}
	cross(e, t) {
		if (e === t) return;
		let n = t > e, r = (r) => n ? r > e && r <= t : r < e && r >= t, i = n ? this.markers : [...this.markers].reverse();
		for (let e of i) if (r(e.time) && (e.callback?.(n ? 1 : -1), e.pause)) return this.pauseAt(e.time);
		if (this.stopAt !== void 0 && r(this.stopAt)) return this.pauseAt(this.stopAt), this.stopAt = void 0, !0;
	}
	pauseAt(e) {
		return this.pause(), this.time = e, !0;
	}
	watch() {
		let e = this.group;
		e.finished.then(() => {
			if (e !== this.group || this.isDone) return;
			this.isDone = !0;
			let { onComplete: t, onReverseComplete: n } = this.options;
			(this.speed < 0 && n || t)?.(), this.resolveFinished();
		});
	}
	newFinished() {
		this.isDone = !1, this.finished = new Promise((e) => {
			this.resolveFinished = e;
		});
	}
};
//#endregion
//#region node_modules/.pnpm/framer-motion@14.7.1_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/framer-motion/dist/es/animation/animate/index.mjs
function La(e) {
	return Array.isArray(e) && e.some(Array.isArray);
}
function Ra(e = {}) {
	let { scope: t, reduceMotion: n, skipAnimations: r } = e;
	function i(e, i, a) {
		let o = Li.current, s = o?.transition, c = {};
		n !== void 0 && (c.reduceMotion = n), r !== void 0 && (c.skipAnimations = r);
		let l;
		if (La(e)) {
			let n = {
				...c,
				...i,
				scope: t
			};
			s && (n.defaultTransition = {
				...s,
				...n.defaultTransition
			}), l = new Ia(e, n);
		} else {
			let { onComplete: n, ...r } = a || {}, o = {
				...c,
				...s,
				...r
			}, { onUpdate: u } = r;
			l = new Ia([typeof e == "number" || typeof e == "string" && (typeof i == "string" || Array.isArray(i)) ? [
				u || (() => {}),
				Array.isArray(i) ? i : [e, i],
				{
					...o,
					onUpdate: void 0
				}
			] : [
				e,
				i,
				o
			]], {
				...c,
				onComplete: n,
				scope: t
			}, Aa(e, i, o, t));
		}
		return o && l.finished.then(o.add(() => l.stop())), l;
	}
	return i;
}
var za = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Ra(), {
	addEffect: ki,
	removeEffect: Ai
});
//#endregion
export { za as animate };
