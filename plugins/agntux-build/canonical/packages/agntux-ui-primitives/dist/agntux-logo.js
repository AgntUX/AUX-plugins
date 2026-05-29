import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function AgntuxLogo({ height = 22, className, ariaLabel = "AgntUX", }) {
    // viewBox preserves the wordmark's aspect ratio — width scales from height.
    const width = (180 / 48) * height;
    return (_jsxs("svg", { width: width, height: height, viewBox: "0 0 180 48", fill: "none", xmlns: "http://www.w3.org/2000/svg", role: "img", "aria-label": ariaLabel, className: className, children: [_jsx("defs", { children: _jsxs("linearGradient", { id: "agntux-logo-ux-gradient", x1: "108", y1: "8", x2: "176", y2: "42", gradientUnits: "userSpaceOnUse", children: [_jsx("stop", { offset: "0%", stopColor: "#19e6c8" }), _jsx("stop", { offset: "50%", stopColor: "#1a8cff" }), _jsx("stop", { offset: "100%", stopColor: "#7c5cff" })] }) }), _jsxs("text", { x: "0", y: "37", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", fontSize: "38", fontWeight: "800", letterSpacing: "-1.5px", children: [_jsx("tspan", { fill: "currentColor", children: "Agnt" }), _jsx("tspan", { fill: "url(#agntux-logo-ux-gradient)", children: "UX" })] })] }));
}
