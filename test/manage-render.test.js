const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ManageRender = require('../public/js/manage/render');

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.textContent = '';
    this.listeners = {};
  }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
}

const document = {
  createElement(tag) { return new FakeElement(tag); }
};

describe('ManageRender', () => {
  it('renders HTML-like player values as text instead of markup', () => {
    const name = '<img src=x onerror="globalThis.hacked=true">';
    const phone = '<script>bad()</script>';
    const item = ManageRender.createPlayerItem(document, { name, phone });
    const info = item.children[0];

    assert.equal(info.children[0].textContent, name);
    assert.equal(info.children[1].textContent, phone);
    assert.equal(item.children.some((child) => child.tag === 'img'), false);
    assert.equal(item.children.some((child) => child.tag === 'script'), false);
  });

  it('stores recipient data through properties and keeps the label textual', () => {
    const name = '<b>Player</b>';
    const item = ManageRender.createRecipientOption(
      document,
      { id: 'p1', name, phone: '5551234567' },
      'confirmed',
      () => {}
    );

    assert.equal(item.children[0].dataset.name, name);
    assert.equal(item.children[1].textContent, name);
  });

  it('renders roster choices as safe text with their phone only', () => {
    const name = '<img src=x onerror="globalThis.hacked=true">';
    const option = ManageRender.createRosterOption(
      document,
      { name, phone: '5551234567', duprRating: 3.75 },
      () => {}
    );

    assert.equal(option.tag, 'label');
    assert.equal(option.children[0].type, 'checkbox');
    assert.equal(option.children[0].dataset.phone, '5551234567');
    assert.equal(option.children[1].children[0].textContent, name);
    assert.equal(option.children[1].children[1].textContent, '(555) 123-4567');
    assert.equal(option.children.some((child) => child.tag === 'img'), false);
  });
});
