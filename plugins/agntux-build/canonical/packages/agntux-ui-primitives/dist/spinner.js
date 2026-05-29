import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Spinner({ size = 6, label = "Loading", className = "", }) {
    const dotStyle = { width: size, height: size };
    return (_jsxs("span", { role: "status", "aria-label": label, className: `inline-flex items-center gap-1 ${className}`, children: [_jsx("span", { className: "inline-block animate-pulse rounded-full bg-current", style: { ...dotStyle, animationDelay: "0ms" } }), _jsx("span", { className: "inline-block animate-pulse rounded-full bg-current", style: { ...dotStyle, animationDelay: "150ms" } }), _jsx("span", { className: "inline-block animate-pulse rounded-full bg-current", style: { ...dotStyle, animationDelay: "300ms" } }), _jsx("span", { className: "sr-only", children: label })] }));
}
