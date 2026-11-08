const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('function renderList(){'), html.indexOf('function setSort(s)'));

function courseList(sort, courses, builtins = []){
  const shown = [];
  const list = {replaceChildren(){shown.length = 0;}, append(course){shown.push(course);}};
  const context = {
    social: {sort, courses, uid: 'me'},
    BUILTIN: builtins,
    $: () => list,
    courseCard: course => course,
    likeCount: id => ({old: 5, recent: 1, official: 0}[id] || 0),
    following: () => [],
    el: () => ({empty: true})
  };
  vm.runInNewContext(source, context);
  context.renderList();
  return shown.map(course => course.id);
}

test('newest includes official courses in actual publication order', () => {
  const courses = [
    {id:'old', createdAt:100, official:false, author:'someone'},
    {id:'official', createdAt:300, official:true, author:'operator'},
    {id:'recent', createdAt:200, official:false, author:'someone'}
  ];
  const builtins = [{id:'built-in', createdAt:1, official:true}];
  assert.deepEqual(courseList('new', courses, builtins), ['official', 'recent', 'old', 'built-in']);
});

test('popularity still sorts by likes regardless of official status', () => {
  const courses = [
    {id:'official', createdAt:300, official:true},
    {id:'old', createdAt:100, official:false},
    {id:'recent', createdAt:200, official:false}
  ];
  assert.deepEqual(courseList('pop', courses), ['old', 'recent', 'official']);
});
