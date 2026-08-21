"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface NavigationItem {
  key: string;
  label: string;
  href: string;
}

export function DesktopNavigation({ items }: { items: readonly NavigationItem[] }) {
  const pathname = usePathname();
  const [activeKey, setActiveKey] = useState(() => activeKeyForPath(items, pathname, ""));

  useEffect(() => {
    const syncFromLocation = () => {
      setActiveKey(activeKeyForPath(items, pathname, window.location.hash));
    };

    syncFromLocation();
    window.addEventListener("hashchange", syncFromLocation);

    if (pathname !== "/") {
      return () => window.removeEventListener("hashchange", syncFromLocation);
    }

    const sectionItems = items
      .map((item) => ({ item, id: new URL(item.href, window.location.origin).hash.slice(1) }))
      .filter(({ id }) => id);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const match = sectionItems.find(({ id }) => id === visible?.target.id);
        if (match) setActiveKey(match.item.key);
      },
      { rootMargin: "-18% 0px -62% 0px", threshold: [0.05, 0.35, 0.7] }
    );

    sectionItems.forEach(({ id }) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });

    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", syncFromLocation);
    };
  }, [items, pathname]);

  return items.map((item) => {
    const isActive = item.key === activeKey;
    return (
      <a
        key={item.key}
        className={isActive ? "is-active" : undefined}
        href={item.href}
        aria-current={isActive ? "location" : undefined}
        onClick={() => setActiveKey(item.key)}
      >
        {item.label}
      </a>
    );
  });
}

function activeKeyForPath(items: readonly NavigationItem[], pathname: string, hash: string) {
  const hashItem = hash
    ? items.find((item) => new URL(item.href, "https://silverkey.ca").hash === hash)
    : undefined;
  if (pathname === "/" && hashItem) return hashItem.key;

  const pathItem = items.find((item) => {
    const url = new URL(item.href, "https://silverkey.ca");
    return url.pathname !== "/" && pathname.startsWith(url.pathname);
  });
  return pathItem?.key ?? items.find((item) => item.key === "home")?.key ?? items[0]?.key ?? "";
}
