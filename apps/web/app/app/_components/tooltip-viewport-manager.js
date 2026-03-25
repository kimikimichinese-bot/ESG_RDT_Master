"use client";

import { useEffect } from "react";

const VIEWPORT_PADDING = 12;
const TOOLTIP_GAP = 12;
const MOBILE_MAX_WIDTH = 280;
const DESKTOP_MAX_WIDTH = 360;

const clamp = (value, min, max) => {
  if (max <= min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
};

const getViewportMaxWidth = () =>
  Math.max(160, Math.min(window.innerWidth < 700 ? MOBILE_MAX_WIDTH : DESKTOP_MAX_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2));

const getPreferredPlacementOrder = (preferred) => {
  if (preferred === "right") {
    return ["right", "left", "bottom", "top"];
  }
  if (preferred === "left") {
    return ["left", "right", "bottom", "top"];
  }
  if (preferred === "bottom") {
    return ["bottom", "top", "right", "left"];
  }
  return ["top", "bottom", "right", "left"];
};

const measureTooltip = (measureNode, text) => {
  const maxWidth = getViewportMaxWidth();
  measureNode.style.maxWidth = `${maxWidth}px`;
  measureNode.textContent = text;
  const rect = measureNode.getBoundingClientRect();
  return {
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
    maxWidth,
  };
};

const computePlacement = (targetRect, tooltipRect, placement) => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxLeft = Math.max(VIEWPORT_PADDING, viewportWidth - tooltipRect.width - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, viewportHeight - tooltipRect.height - VIEWPORT_PADDING);

  let rawLeft = 0;
  let rawTop = 0;

  if (placement === "right") {
    rawLeft = targetRect.right + TOOLTIP_GAP;
    rawTop = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
  } else if (placement === "left") {
    rawLeft = targetRect.left - tooltipRect.width - TOOLTIP_GAP;
    rawTop = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
  } else if (placement === "bottom") {
    rawLeft = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
    rawTop = targetRect.bottom + TOOLTIP_GAP;
  } else {
    rawLeft = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
    rawTop = targetRect.top - tooltipRect.height - TOOLTIP_GAP;
  }

  const overflow =
    Math.max(0, VIEWPORT_PADDING - rawLeft) +
    Math.max(0, rawLeft + tooltipRect.width + VIEWPORT_PADDING - viewportWidth) +
    Math.max(0, VIEWPORT_PADDING - rawTop) +
    Math.max(0, rawTop + tooltipRect.height + VIEWPORT_PADDING - viewportHeight);

  return {
    placement,
    overflow,
    left: clamp(rawLeft, VIEWPORT_PADDING, maxLeft),
    top: clamp(rawTop, VIEWPORT_PADDING, maxTop),
  };
};

export default function TooltipViewportManager() {
  useEffect(() => {
    const measureNode = document.createElement("div");
    measureNode.className = "enterprise-tooltip-measure";
    measureNode.setAttribute("aria-hidden", "true");
    document.body.appendChild(measureNode);

    let activeTooltip = null;
    let frame = 0;

    const clearTooltip = (tooltip) => {
      if (!tooltip) {
        return;
      }
      tooltip.removeAttribute("data-tooltip-ready");
      tooltip.dataset.tooltipVisible = "false";
      tooltip.removeAttribute("data-tooltip-resolved-placement");
      tooltip.style.removeProperty("--tooltip-x");
      tooltip.style.removeProperty("--tooltip-y");
      tooltip.style.removeProperty("--tooltip-max-width");
    };

    const renderTooltip = (tooltip) => {
      if (!tooltip || !tooltip.isConnected) {
        return;
      }

      const text = typeof tooltip.dataset.tooltip === "string" ? tooltip.dataset.tooltip.trim() : "";
      if (!text) {
        clearTooltip(tooltip);
        return;
      }

      const targetRect = tooltip.getBoundingClientRect();
      const preferred = tooltip.dataset.tooltipPlacement || "top";
      const size = measureTooltip(measureNode, text);
      const placements = getPreferredPlacementOrder(preferred).map((placement) =>
        computePlacement(targetRect, { width: size.width, height: size.height }, placement),
      );
      const bestPlacement = placements.sort((left, right) => left.overflow - right.overflow)[0];

      tooltip.dataset.tooltipReady = "true";
      tooltip.dataset.tooltipVisible = "true";
      tooltip.dataset.tooltipResolvedPlacement = bestPlacement.placement;
      tooltip.style.setProperty("--tooltip-x", `${Math.round(bestPlacement.left)}px`);
      tooltip.style.setProperty("--tooltip-y", `${Math.round(bestPlacement.top)}px`);
      tooltip.style.setProperty("--tooltip-max-width", `${size.maxWidth}px`);
    };

    const scheduleRender = () => {
      if (!activeTooltip) {
        return;
      }
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        renderTooltip(activeTooltip);
      });
    };

    const activateTooltip = (tooltip) => {
      if (!tooltip || tooltip === activeTooltip) {
        scheduleRender();
        return;
      }
      clearTooltip(activeTooltip);
      activeTooltip = tooltip;
      scheduleRender();
    };

    const deactivateTooltip = (tooltip) => {
      if (!tooltip || tooltip !== activeTooltip) {
        return;
      }
      clearTooltip(activeTooltip);
      activeTooltip = null;
      cancelAnimationFrame(frame);
    };

    const findTooltip = (target) => (target instanceof Element ? target.closest(".enterprise-tooltip[data-tooltip]") : null);

    const handleMouseOver = (event) => {
      activateTooltip(findTooltip(event.target));
    };

    const handleMouseOut = (event) => {
      const tooltip = findTooltip(event.target);
      if (!tooltip || tooltip !== activeTooltip) {
        return;
      }
      const relatedTooltip = findTooltip(event.relatedTarget);
      if (relatedTooltip === tooltip) {
        return;
      }
      deactivateTooltip(tooltip);
    };

    const handleFocusIn = (event) => {
      activateTooltip(findTooltip(event.target));
    };

    const handleFocusOut = (event) => {
      const tooltip = findTooltip(event.target);
      if (!tooltip || tooltip !== activeTooltip) {
        return;
      }
      const relatedTooltip = findTooltip(event.relatedTarget);
      if (relatedTooltip === tooltip) {
        return;
      }
      deactivateTooltip(tooltip);
    };

    const handleViewportChange = () => {
      scheduleRender();
    };

    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      clearTooltip(activeTooltip);
      activeTooltip = null;
      measureNode.remove();
    };
  }, []);

  return null;
}
