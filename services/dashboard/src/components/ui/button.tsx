import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline" | "destructive";
  size?: "sm" | "md" | "lg";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-full font-medium transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          "disabled:pointer-events-none disabled:opacity-50",
          variant === "default" &&
            "bg-accent text-white hover:opacity-90 shadow-glow",
          variant === "ghost" &&
            "bg-transparent text-foreground/80 hover:text-foreground hover:bg-white/5",
          variant === "outline" &&
            "border border-foreground/20 bg-transparent text-foreground/80 hover:bg-white/5",
          variant === "destructive" &&
            "bg-red-600 text-white hover:bg-red-700",
          size === "sm" && "h-9 px-4 text-sm",
          size === "md" && "h-11 px-6 text-sm",
          size === "lg" && "h-14 px-8 text-base",
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button };
