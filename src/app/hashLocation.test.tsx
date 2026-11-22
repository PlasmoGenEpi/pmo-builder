import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route, Router, Switch, useLocation, useSearch } from "wouter";

import {
  lastNavigationKind,
  navigate,
  splitHash,
  useHashLocation,
  useHashSearch,
} from "./hashLocation";

function LocationProbe() {
  const [path] = useLocation();
  const search = useSearch();
  return (
    <div>
      <output data-testid="path">{path}</output>
      <output data-testid="search">{search}</output>
      <Switch>
        <Route path="/published">
          <span data-testid="route">published</span>
        </Route>
        <Route path="/published/:id">
          {(params) => <span data-testid="route">dataset:{params.id}</span>}
        </Route>
        <Route>
          <span data-testid="route">other</span>
        </Route>
      </Switch>
    </div>
  );
}

describe("splitHash", () => {
  it("separates path and query from hash addresses", () => {
    expect(splitHash("")).toEqual({ path: "/", search: "" });
    expect(splitHash("#")).toEqual({ path: "/", search: "" });
    expect(splitHash("#/")).toEqual({ path: "/", search: "" });
    expect(splitHash("#/published")).toEqual({ path: "/published", search: "" });
    expect(splitHash("#published")).toEqual({ path: "/published", search: "" });
    expect(splitHash("#/published?q=kenya&country=Kenya")).toEqual({
      path: "/published",
      search: "q=kenya&country=Kenya",
    });
    expect(splitHash("#/published?q=a?b")).toEqual({ path: "/published", search: "q=a?b" });
    expect(splitHash("#/?q=1")).toEqual({ path: "/", search: "q=1" });
    expect(splitHash("#/published?")).toEqual({ path: "/published", search: "" });
  });
});

describe("useHashLocation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/#/published");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("matches routes while keeping query parameters inside the hash", () => {
    window.history.replaceState(null, "", "/?lang=fr#/published?q=kenya&country=Kenya");
    render(
      <Router hook={useHashLocation}>
        <LocationProbe />
      </Router>,
    );

    expect(screen.getByTestId("path")).toHaveTextContent("/published");
    expect(screen.getByTestId("search")).toHaveTextContent("q=kenya&country=Kenya");
    expect(screen.getByTestId("route")).toHaveTextContent("published");
    expect(window.location.search).toBe("?lang=fr");
  });

  it("preserves window.location.search and tracks push vs replace navigation", () => {
    window.history.replaceState(null, "", "/?lang=fr#/published");
    render(
      <Router hook={useHashLocation}>
        <LocationProbe />
      </Router>,
    );
    const initialLength = window.history.length;

    act(() => {
      navigate("/published?q=u", { replace: true });
      navigate("/published?q=ug", { replace: true });
    });
    expect(window.location.search).toBe("?lang=fr");
    expect(window.location.hash).toBe("#/published?q=ug");
    expect(window.history.length).toBe(initialLength);
    expect(lastNavigationKind()).toBe("replace");
    expect(screen.getByTestId("search")).toHaveTextContent("q=ug");

    act(() => {
      navigate("/published?q=ug&country=Uganda");
    });
    expect(window.location.search).toBe("?lang=fr");
    expect(window.location.hash).toBe("#/published?q=ug&country=Uganda");
    expect(window.history.length).toBe(initialLength + 1);
    expect(lastNavigationKind()).toBe("push");
    expect(screen.getByTestId("search")).toHaveTextContent("q=ug&country=Uganda");
  });

  it("records pop navigation on popstate and keeps it across a following hashchange", () => {
    render(
      <Router hook={useHashLocation}>
        <LocationProbe />
      </Router>,
    );

    act(() => {
      navigate("/published?q=kenya");
      navigate("/published/301");
    });
    expect(lastNavigationKind()).toBe("push");
    expect(screen.getByTestId("route")).toHaveTextContent("dataset:301");

    act(() => {
      window.history.replaceState(null, "", "/#/published?q=kenya");
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(lastNavigationKind()).toBe("pop");
    expect(screen.getByTestId("path")).toHaveTextContent("/published");
    expect(screen.getByTestId("search")).toHaveTextContent("q=kenya");
    expect(screen.getByTestId("route")).toHaveTextContent("published");
  });

  it("attaches searchHook and hrefs formatter for wouter", () => {
    expect(useHashLocation.searchHook).toBe(useHashSearch);
    expect(useHashLocation.hrefs("/published?q=kenya")).toBe("#/published?q=kenya");
  });
});
