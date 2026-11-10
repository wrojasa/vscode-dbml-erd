# Data model notes

Put the cursor inside the block below and run **DBML ERD: Open ER Diagram to the Side**
(or click the diagram icon in the editor title bar).

```dbml
Table user {
  id integer [pk, not null]
  username varchar(60) [not null, unique]
  created_at datetime [not null]
}

Table post {
  id integer [pk, not null]
  user_id integer [not null, ref: > user.id]
  title varchar(200) [not null]
  body text
}

Table comment {
  id integer [pk, not null]
  post_id integer [not null, ref: > post.id]
  user_id integer [ref: > user.id]
  body text [not null]
}
```

A second block in the same file gets its own preview:

```dbml
Table tag {
  id integer [pk, not null]
  name varchar(40) [not null, unique]
}

Table post_tag {
  post_id integer [pk, not null]
  tag_id integer [pk, not null, ref: > tag.id]
}
```
