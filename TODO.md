is stripe email unique and verified? then rely on it. stripe pay = login.

it's not. acc recovery through email verification?

Changed logic to only create user after payment. Will still create empty DOs (to check) and it will run migrations there and submit that it did that, so still need to find a way to clean this up nicely, possibly at the `remote-sql-cursor` level?
