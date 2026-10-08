---
title: {{ replace .File.ContentBaseName "-" " " | title | jsonify }}
date: {{ .Date }}
draft: true
summary: ""
tags: []
categories: []
comments: true
math: false

cover:
  image: ""
  alt: ""
  relative: true
---

## 背景

写下要解决的问题，以及读者需要知道的背景。

## 正文

按步骤说明过程。需要图片时，将图片放在本文章目录，然后使用 `![图片说明](image.png)`。

## 总结

记录结论、限制和下一步。
