import * as React from "react";
import { Tabs as BaseTabs } from "@mui/base/Tabs";
import { TabPanel as BaseTabPanel } from "@mui/base/TabPanel";
import { TabsList as BaseTabsList } from "@mui/base/TabsList";
import { Tab as BaseTab } from "@mui/base/Tab";
import { cn } from "@/lib/utils";

const Tabs = BaseTabs;

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTabsList>
>(({ className, ...props }, ref) => (
  <BaseTabsList
    ref={ref}
    className={cn(
      "inline-flex items-center gap-2 rounded-full bg-black/30 p-1",
      className
    )}
    {...props}
  />
));

TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseTab>
>(({ className, ...props }, ref) => (
  <BaseTab
    ref={ref}
    className={cn(
      "rounded-full px-4 py-2 text-sm font-medium text-foreground/60 transition",
      "data-[selected=true]:bg-accent data-[selected=true]:text-white",
      "aria-selected:bg-accent aria-selected:text-white",
      className
    )}
    {...props}
  />
));

TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTabPanel>
>(({ className, ...props }, ref) => (
  <BaseTabPanel ref={ref} className={cn("mt-6", className)} {...props} />
));

TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
