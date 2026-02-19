/**
 * Google Flights DOM extraction script.
 *
 * This script is executed inside the browser page context by the browser tool.
 * It extracts flight search results from the Google Flights DOM and returns
 * a structured text summary.
 *
 * Because this runs inside evaluate(), it has NO access to Node.js APIs
 * — only DOM APIs are available.
 */
(() => {
  /**
   * Extract text content from all elements matching a selector.
   * @param {string} selector - CSS selector to query.
   * @returns {string[]} Array of trimmed text content strings.
   */
  function getTextFromAll(selector) {
    const elements = document.querySelectorAll(selector);
    const results = [];
    elements.forEach((element) => {
      const text = (element.textContent || '').trim();
      if (text.length > 0) {
        results.push(text);
      }
    });
    return results;
  }

  /**
   * Try multiple known selectors for Google Flights result cards.
   * Google Flights uses dynamic class names, so we try several approaches.
   * @returns {string[]} Array of flight result text blocks.
   */
  function extractFlightCards() {
    // Google Flights renders results in list items with role="listitem"
    const listItems = getTextFromAll('[role="listitem"]');
    if (listItems.length > 0) {
      return listItems;
    }

    // Fallback: look for elements containing price-like patterns
    const allElements = document.querySelectorAll('div, li, span');
    const flightTexts = [];
    const pricePattern = /\$\d+/;
    const seen = new Set();

    allElements.forEach((element) => {
      const text = (element.textContent || '').trim();
      if (
        text.length > 20 &&
        text.length < 500 &&
        pricePattern.test(text) &&
        !seen.has(text)
      ) {
        seen.add(text);
        flightTexts.push(text);
      }
    });

    return flightTexts;
  }

  // --- Main extraction logic ------------------------------------------------
  const flights = extractFlightCards();

  if (flights.length === 0) {
    // Grab the full page text as a last resort
    const bodyText = (document.body.textContent || '').trim();
    const truncatedBody = bodyText.substring(0, 5000);
    return `No structured flight results found.\n\nPage content preview:\n${truncatedBody}`;
  }

  // Limit to top 10 results to keep payload manageable
  const topFlights = flights.slice(0, 10);

  const header = `Found ${flights.length} flight result(s). Showing top ${topFlights.length}:\n`;
  const body = topFlights
    .map((flight, index) => `--- Flight ${index + 1} ---\n${flight}`)
    .join('\n\n');

  return `${header}\n${body}`;
})();
