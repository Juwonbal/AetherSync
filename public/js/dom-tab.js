/**
 * OmniDebug - Laptop Dashboard: DOM & Elements Inspector
 */

window.DOMTab = (function() {
  'use strict';

  let sendWS = null;
  let treeContainer = null;
  let stylesContainer = null;
  let selectedNode = null;

  function init(wsSender) {
    sendWS = wsSender;
    treeContainer = document.getElementById('dom-tree-container');
    stylesContainer = document.getElementById('dom-styles-container');

    const btnRefresh = document.getElementById('dom-btn-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        sendWS({ type: 'dom_request' });
      });
    }

    const btnApplyStyles = document.getElementById('dom-btn-apply-style');
    if (btnApplyStyles) {
      btnApplyStyles.addEventListener('click', applyCustomStyles);
    }
  }

  function handleDOMTree(msg) {
    if (!treeContainer || !msg.tree) return;
    treeContainer.innerHTML = '';
    const rootEl = renderNode(msg.tree);
    if (rootEl) {
      treeContainer.appendChild(rootEl);
    }
  }

  function renderNode(node) {
    if (!node) return null;

    if (node.type === 'text') {
      const textDiv = document.createElement('div');
      textDiv.className = 'dom-node dom-text-node';
      textDiv.style.paddingLeft = '18px';
      textDiv.innerHTML = `<span class="dom-text-content">"${escapeHTML(node.text)}"</span>`;
      return textDiv;
    }

    if (node.type === 'element') {
      const elDiv = document.createElement('div');
      elDiv.className = 'dom-node-wrapper';

      const tagLine = document.createElement('div');
      tagLine.className = 'dom-node';
      tagLine.dataset.nodeId = node.id;
      tagLine.dataset.tagName = node.tagName;

      // Build tag line HTML
      let tagHtml = `<span class="dom-tag">&lt;${node.tagName}</span>`;
      if (node.attributes) {
        for (const [k, v] of Object.entries(node.attributes)) {
          tagHtml += ` <span class="dom-attr-name">${escapeHTML(k)}</span>="<span class="dom-attr-val">${escapeHTML(v)}</span>"`;
        }
      }
      tagHtml += `<span class="dom-tag">&gt;</span>`;
      tagLine.innerHTML = tagHtml;

      // Event listeners for hover highlight & selection
      tagLine.addEventListener('mouseenter', () => {
        sendWS({
          type: 'dom_highlight',
          nodeDebugId: node.id,
          selector: getSelectorForNode(node)
        });
      });

      tagLine.addEventListener('mouseleave', () => {
        sendWS({
          type: 'dom_highlight',
          selector: null
        });
      });

      tagLine.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.dom-node.selected').forEach(el => el.classList.remove('selected'));
        tagLine.classList.add('selected');
        selectDOMNode(node);
      });

      elDiv.appendChild(tagLine);

      // Render children if present
      if (node.children && node.children.length > 0) {
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'dom-children';
        childrenDiv.style.paddingLeft = '16px';
        childrenDiv.style.borderLeft = '1px solid rgba(255,255,255,0.06)';
        childrenDiv.style.marginLeft = '6px';

        node.children.forEach(child => {
          const childEl = renderNode(child);
          if (childEl) childrenDiv.appendChild(childEl);
        });

        elDiv.appendChild(childrenDiv);

        // Closing tag
        const closeTag = document.createElement('div');
        closeTag.className = 'dom-node';
        closeTag.innerHTML = `<span class="dom-tag">&lt;/${node.tagName}&gt;</span>`;
        elDiv.appendChild(closeTag);
      }

      return elDiv;
    }

    return null;
  }

  function selectDOMNode(node) {
    selectedNode = node;
    const selectorDisplay = document.getElementById('selected-element-selector');
    if (selectorDisplay) {
      selectorDisplay.textContent = getSelectorForNode(node);
    }

    const attrsList = document.getElementById('dom-node-attributes');
    if (attrsList) {
      attrsList.innerHTML = '';
      if (node.attributes) {
        for (const [k, v] of Object.entries(node.attributes)) {
          const item = document.createElement('div');
          item.style.fontSize = '12px';
          item.style.marginBottom = '4px';
          item.innerHTML = `<span style="color:#fbbf24;">${escapeHTML(k)}</span>: <span style="color:#34d399;">${escapeHTML(v)}</span>`;
          attrsList.appendChild(item);
        }
      }
    }
  }

  function getSelectorForNode(node) {
    if (!node) return '';
    if (node.attributes && node.attributes.id) {
      return `#${node.attributes.id}`;
    }
    if (node.attributes && node.attributes.class) {
      const firstClass = node.attributes.class.split(' ')[0];
      if (firstClass) return `.${firstClass}`;
    }
    return node.tagName || 'div';
  }

  function applyCustomStyles() {
    if (!selectedNode) {
      alert('Please click an element in the DOM tree first!');
      return;
    }

    const propInput = document.getElementById('style-prop-input');
    const valInput = document.getElementById('style-val-input');
    if (!propInput || !valInput) return;

    const prop = propInput.value.trim();
    const val = valInput.value.trim();

    if (prop && val) {
      const styles = {};
      styles[prop] = val;
      const selector = getSelectorForNode(selectedNode);

      sendWS({
        type: 'dom_update_style',
        selector: selector,
        styles: styles
      });

      // Clear inputs
      propInput.value = '';
      valInput.value = '';
    }
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return {
    init,
    handleDOMTree
  };
})();
