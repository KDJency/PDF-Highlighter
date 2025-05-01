import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import './index.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

interface Reference {
  content: string;
}

interface TextItemWithBounds {
  pageIndex: number;
  str: string;
  bounds: { x: number; y: number; width: number; height: number }[]; // Store bounds relative to page
}

interface HighlightRect {
  pageIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  id: string;
}

const references: Reference[] = [
  {
    content:
      'Cigna Dental Preventive Plan If You Wish To Cancel Or If You Have Questions If You are not satisfied, for any reason, with the terms of this Policy You may return it to Us within 10 days of receipt. We will then cancel Your coverage as of the original Effective Date and promptly refund any premium You have paid. This Policy will then be null and void. If You wish to correspond with Us for this or any other reason, write: Cigna Cigna Individual Services P. O. Box 30365 Tampa, FL 33630 1-877-484-5967',
  },
  {
    content:
      'EXCLUSIONS AND LIMITATIONS: WHAT IS NOT COVERED BY THIS POLICY........................................ 11',
  },
  {
    content:
      'Notice Regarding Provider Directories and Provider Networks If Your Plan utilizes a network of Providers, you will automatically and without charge, receive a separate listing of Participating Providers. You may also have access to a list of Providers who participate in the network by visiting www.cigna.com; mycigna.com. Your Participating Provider network consists of a group of local dental practitioners, of varied specialties as well as general practice, who are employed by or contracted with Cigna HealthCare or Cigna Dental Health. Notice Regarding Standard of Care Under state law, Cigna is required to adhere to the accepted standards of care in the administration of health benefits. Failure to adhere to the accepted standards of care may subject Cigna to liability for damages. PLEASE READ THE FOLLOWING IMPORTANT NOTICE',
  },
];

// Simplifies matching by removing excessive whitespace and line breaks
const normalizeText = (text: string): string => {
  return text.replace(/\s+/g, ' ').trim();
};

function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [extractedTextItems, setExtractedTextItems] = useState<TextItemWithBounds[]>([]);
  const [highlights, setHighlights] = useState<HighlightRect[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const pageRenderRefs = useRef<(HTMLDivElement | null)[]>([]); // Refs for each page container

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      setError(null);
      setPdfDocument(null); // Reset previous document
      setNumPages(0);
      setExtractedTextItems([]);
      setHighlights([]);
      pageRenderRefs.current = []; // Reset refs
    } else {
      setPdfFile(null);
      setError('Please select a valid PDF file.');
    }
  };

  useEffect(() => {
    if (!pdfFile) return;

    const loadAndExtract = async () => {
      setIsProcessing(true);
      setError(null);
      setHighlights([]); // Clear previous highlights
      try {
        const arrayBuffer = await pdfFile.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        setPdfDocument(pdf);
        setNumPages(pdf.numPages);
        pageRenderRefs.current = Array(pdf.numPages).fill(null); // Initialize refs array

        // Extract text from all pages
        const allTextItems: TextItemWithBounds[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.0 });
          const textContent = await page.getTextContent();

          textContent.items.forEach((item) => {
            if ('str' in item && item.str.trim().length > 0) {
              // Calculate bounds relative to the page (scale 1.0)
              const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
              const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
              const itemHeight = item.height ? item.height * viewport.scale : fontHeight;

              // Adjust position based on transform
              // transform[4] is x, transform[5] is y (bottom-left)
              const x = item.transform[4];
              const y = viewport.height - item.transform[5] - itemHeight;

              allTextItems.push({
                ...item,
                pageIndex: i - 1,
                bounds: [{ x: x, y: y, width: item.width, height: itemHeight }]
              });
            }
          });
          // Clean up page resources
          page.cleanup();
        }
        setExtractedTextItems(allTextItems);
      } catch (err: any) {
        console.error('Error loading/processing PDF:', err);
        setError(
          `Failed to load or process PDF: ${err?.message || 'Unknown error'}`
        );
        setPdfDocument(null);
        setNumPages(0);
        setExtractedTextItems([]);
      } finally {
        setIsProcessing(false);
      }
    };

    loadAndExtract();
  }, [pdfFile]);

  const renderPages = useCallback(async () => {
    if (!pdfDocument) return;

    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const pageContainer = pageRenderRefs.current[pageNum - 1];
      if (!pageContainer) continue; // Skip if ref not set

      // Avoid re-rendering if canvas already exists
      if (pageContainer.querySelector('canvas')) continue;

      try {
        const page = await pdfDocument.getPage(pageNum);
        const desiredWidth = pageContainer.clientWidth || 800;
        const viewportBase = page.getViewport({ scale: 1.0 });
        const scale = desiredWidth / viewportBase.width;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.setProperty('--scale-factor', scale.toString());

        pageContainer.appendChild(canvas);
        pageContainer.style.height = `${viewport.height}px`;
        pageContainer.style.width = `${viewport.width}px`;


        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };
        await page.render(renderContext).promise;
      } catch (renderError) {
        console.error(`Error rendering page ${pageNum}:`, renderError);
        setError(`Error rendering page ${pageNum}.`);
      }
    }
  }, [pdfDocument]);


  useEffect(() => {
    if (pdfDocument && numPages > 0) {
      // Use setTimeout to ensure containers are in the DOM for measurement
      setTimeout(() => {
        renderPages();
      }, 0);
    }
  }, [pdfDocument, numPages, renderPages]);

  const findAndHighlightText = async (searchText: string) => {
    if (!extractedTextItems.length || !pdfDocument) return;

    setIsProcessing(true);
    setHighlights([]); // Clear previous highlights
    const normalizedSearch = normalizeText(searchText);
    if (!normalizedSearch) {
      setIsProcessing(false);
      return;
    }

    const foundHighlights: HighlightRect[] = [];
    let firstMatchPageIndex = -1;

    const pageTexts: { pageIndex: number; text: string }[] = [];
    let currentPageIndex = -1;
    let currentPageText = '';
    extractedTextItems.forEach(item => {
      if (item.pageIndex !== currentPageIndex) {
        if (currentPageIndex !== -1) {
          pageTexts.push({ pageIndex: currentPageIndex, text: normalizeText(currentPageText) });
        }
        currentPageIndex = item.pageIndex;
        currentPageText = '';
      }
      currentPageText += (item.str || '') + ' '; // Add space between items
    });
    if (currentPageIndex !== -1) { // Add last page
      pageTexts.push({ pageIndex: currentPageIndex, text: normalizeText(currentPageText) });
    }

    let matchFoundOnPage = -1;
    for (const pageData of pageTexts) {
      if (pageData.text.includes(normalizedSearch)) {
        matchFoundOnPage = pageData.pageIndex;
        break; // Found the first occurrence page
      }
    }

    if (matchFoundOnPage === -1) {
      console.log("Text not found on any page:", normalizedSearch);
      setIsProcessing(false);
      return;
    }

    firstMatchPageIndex = matchFoundOnPage;
    console.log(`Match potentially found on page index: ${firstMatchPageIndex}`);

    // Find the specific sequence of TextItems on that page ---
    const itemsOnPage = extractedTextItems.filter(item => item.pageIndex === firstMatchPageIndex);
    let finalMatchedItems: TextItemWithBounds[] = [];

    // Iterate through each item on the page as a potential start of the match
    for (let i = 0; i < itemsOnPage.length; i++) {
      let currentMatchText = '';
      const potentialMatchItems: TextItemWithBounds[] = [];

      for (let j = i; j < itemsOnPage.length; j++) {
        const currentItem = itemsOnPage[j];
        if (!currentItem.str) continue; // Skip items without text

        potentialMatchItems.push(currentItem);

        // Normalize AFTER joining to better handle spaces between items
        const textFromSequence = potentialMatchItems.map(it => it.str).join(' ');
        currentMatchText = normalizeText(textFromSequence);

        if (currentMatchText.includes(normalizedSearch)) {
          // Match found! Store these items and stop searching.
          finalMatchedItems = [...potentialMatchItems];
          console.log(`Match found using ${finalMatchedItems.length} items.`);
          break; // Exit inner loop (j)
        } else if (normalizedSearch.startsWith(currentMatchText)) {
          // Partial match, continue adding items from this sequence
          continue; // Continue inner loop (j)
        } else {
          // Mismatch. The sequence starting at itemsOnPage[i] doesn't work.
          break; // Exit inner loop (j), the outer loop (i) will try the next starting item
        }
      } // End inner loop (j)

      // If we found the full match in the inner loop, break the outer loop too
      if (finalMatchedItems.length > 0) {
        break; // Exit outer loop (i)
      }
    } // End outer loop (i)


    if (finalMatchedItems.length === 0) {
      console.warn("Could not pinpoint the exact sequence of text items for highlighting, though found on page.", normalizedSearch);
      setHighlights([]); // Clear highlights if sequence not found
      setIsProcessing(false);
      return;
    }

    const pageContainer = pageRenderRefs.current[firstMatchPageIndex];
    const canvas = pageContainer?.querySelector('canvas');
    if (!pageContainer || !canvas) {
      console.error("Cannot find page container or canvas for highlighting.");
      setIsProcessing(false);
      return;
    }

    const scaleFactor = parseFloat(canvas.style.getPropertyValue('--scale-factor') || '1');

    try {
      finalMatchedItems.forEach((item, idx) => {
        const itemBounds = item.bounds[0];
        const highlightLeft = itemBounds.x * scaleFactor;
        const highlightTop = itemBounds.y * scaleFactor;
        const highlightWidth = itemBounds.width * scaleFactor;
        const highlightHeight = itemBounds.height * scaleFactor;

        const finalLeft = Math.max(0, highlightLeft);
        const finalTop = Math.max(0, highlightTop);
        const finalWidth = Math.min(canvas.width - finalLeft, highlightWidth);
        const finalHeight = Math.min(canvas.height - finalTop, highlightHeight);

        if (finalWidth > 0 && finalHeight > 0) {
          foundHighlights.push({
            pageIndex: item.pageIndex,
            left: finalLeft,
            top: finalTop,
            width: finalWidth,
            height: finalHeight,
            id: `highlight-${item.pageIndex}-${idx}-${Date.now()}`,
          });
        }
      }); // End forEach finalMatchedItems

      setHighlights(foundHighlights);

      // Scroll the first highlight into view
      if (foundHighlights.length > 0 && pageRenderRefs.current[firstMatchPageIndex]) {
        setTimeout(() => {
          const firstHighlightElement = document.getElementById(foundHighlights[0].id);
          console.log("Scrolling to:", firstHighlightElement);
          firstHighlightElement?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 100);
      }

    } catch (vpError) {
      console.error("Error getting page or viewport for highlight calculation:", vpError);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="App">
      <div className="sidebar">
        <h2>References</h2>
        <input type="file" onChange={handleFileChange} accept="application/pdf" />
        {error && <p className="error">{error}</p>}
        {isProcessing && <p>Processing...</p>}
        <div className="reference-list">
          {references.map((ref, index) => (
            <button
              key={index}
              onClick={() => findAndHighlightText(ref.content)}
              disabled={!pdfDocument || isProcessing || !extractedTextItems.length}
            >
              {ref.content}
            </button>
          ))}
        </div>
      </div>

      <div className="pdf-viewer">
        {pdfDocument && numPages > 0 ? (
          Array.from({ length: numPages }, (_, i) => (
            <div
              key={`page-${i}`}
              id={`page-container-${i}`}
              ref={(el: HTMLDivElement | null) => {
                if (pageRenderRefs.current) {
                  pageRenderRefs.current[i] = el;
                }
              }}
              className="page-container"
              style={{ position: 'relative' }}
            >
              {highlights
                .filter((h) => h.pageIndex === i)
                .map((h) => (
                  <div
                    key={h.id}
                    id={h.id}
                    className="highlight-box"
                    style={{
                      left: `${h.left}px`,
                      top: `${h.top}px`,
                      width: `${h.width}px`,
                      height: `${h.height}px`,
                    }}
                  />
                ))}
              {/* Canvas will be appended here by renderPages */}
              {!pageRenderRefs.current[i]?.querySelector('canvas') && <div className="loading-placeholder">Loading page {i + 1}...</div>}
            </div>
          ))
        ) : (
          !isProcessing && !error && <p className='select-info'>Please select a PDF file to view.</p>
        )}
        {isProcessing && !pdfDocument && <p>Loading PDF...</p>}
      </div>
    </div>
  );
}

export default App;