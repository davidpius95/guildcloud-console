import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import HomePage from "@/app/page";

test("landing page does not present planned services as available", () => {
  render(<HomePage />);

  expect(screen.queryByText(/daily encrypted off-site backup/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/GuildCloud is wallet-first/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Paystack and Flutterwave/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/safe resize, volumes, backup, monitoring/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/browser recovery console/i)).not.toBeInTheDocument();
  expect(screen.queryByText("Wallet-first")).not.toBeInTheDocument();
  expect(screen.getAllByText(/not available yet/i).length).toBeGreaterThan(0);
});
